import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarginEquivalentSizing, largestLotsWithinMargin, normalizeReferenceLots } from '../src/execution/margin_equivalent_sizing.js';

test('normalizes familiar reference lots down to the broker step', () => {
  assert.equal(normalizeReferenceLots(0.913, { minLots:0.01,maxLots:100,stepLots:0.01 }), 0.91);
});

test('finds largest executable target lot that stays within reference margin budget', async () => {
  const result = await largestLotsWithinMargin({
    instrument:{minLots:0.1,maxLots:10,stepLots:0.1},
    marginBudget:90,
    estimateMargin: async (lots) => lots * 200,
  });
  assert.equal(result.lots, 0.4);
  assert.equal(result.expectedMargin, 80);
});

test('fails closed when broker minimum would exceed equivalent exposure budget', async () => {
  await assert.rejects(() => largestLotsWithinMargin({
    instrument:{minLots:0.5,maxLots:10,stepLots:0.5},
    marginBudget:50,
    estimateMargin: async (lots) => lots * 200,
  }), (error) => error?.code === 'MARGIN_EQUIVALENT_BELOW_BROKER_MINIMUM');
});

test('caps reference margin budget by configured account capacity percentage', async () => {
  const result = await buildMarginEquivalentSizing({
    referenceLots:0.9,
    referenceInstrument:{minLots:0.01,maxLots:100,stepLots:0.01},
    targetInstrument:{minLots:0.01,maxLots:100,stepLots:0.01},
    maxMarginPercent:10,
    accountCapacity:500,
    estimateReferenceMargin:async (lots) => lots * 1000,
    estimateTargetMargin:async (lots) => lots * 500,
  });
  assert.equal(result.referenceMargin,900);
  assert.equal(result.marginBudget,50);
  assert.equal(result.lots,0.1);
  assert.equal(result.expectedMargin,50);
});

test('does not require stop loss or take profit inputs', async () => {
  const result = await buildMarginEquivalentSizing({
    referenceLots:0.9,
    referenceInstrument:{minLots:0.01,maxLots:100,stepLots:0.01},
    targetInstrument:{minLots:0.1,maxLots:10,stepLots:0.1},
    maxMarginPercent:100,
    accountCapacity:10000,
    estimateReferenceMargin:async () => 90,
    estimateTargetMargin:async (lots) => lots * 200,
  });
  assert.equal(result.lots,0.4);
});
