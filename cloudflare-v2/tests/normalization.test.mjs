import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSymbol, normalizeOrderIntent, normalizePrice, normalizeVolumeForMT5, normalizeVolumeForCTrader } from '../src/normalization/trading_normalizer.js';

test('normalizes common cross-broker symbol aliases without losing source symbol', () => {
  assert.deepEqual(normalizeSymbol('GOLD'), { canonical: 'XAUUSD', source: 'GOLD' });
  assert.deepEqual(normalizeSymbol('XAU/USD'), { canonical: 'XAUUSD', source: 'XAU/USD' });
  assert.equal(normalizeSymbol('XAUUSD.m').canonical, 'XAUUSD');
  assert.equal(normalizeSymbol('DJ30').canonical, 'US30');
  assert.equal(normalizeSymbol('USTEC').canonical, 'NAS100');
  assert.equal(normalizeSymbol('DAX40').canonical, 'GER40');
  assert.equal(normalizeSymbol('Volatility 75 Index').canonical, 'DERIV:VOLATILITY_75');
});

test('normalizes market and pending order language', () => {
  assert.deepEqual(normalizeOrderIntent('BUY'), { side: 'BUY', orderType: 'MARKET' });
  assert.deepEqual(normalizeOrderIntent('sell limit'), { side: 'SELL', orderType: 'LIMIT' });
  assert.deepEqual(normalizeOrderIntent('BUY STOP'), { side: 'BUY', orderType: 'STOP' });
  assert.deepEqual(normalizeOrderIntent('sell stop limit'), { side: 'SELL', orderType: 'STOP_LIMIT' });
});

test('normalizes price to broker tick size and precision', () => {
  assert.equal(normalizePrice(2526.237, { digits: 2, tickSize: 0.01 }), 2526.24);
  assert.equal(normalizePrice(1.0834567, { digits: 5, tickSize: 0.00001 }), 1.08346);
  assert.equal(normalizePrice(4321.27, { digits: 1, tickSize: 0.1 }), 4321.3);
});

test('normalizes canonical lots for MT5 volume constraints', () => {
  assert.equal(normalizeVolumeForMT5(0.037, { min: 0.01, max: 100, step: 0.01 }), 0.04);
  assert.equal(normalizeVolumeForMT5(0.001, { min: 0.01, max: 100, step: 0.01 }), 0.01);
  assert.equal(normalizeVolumeForMT5(120, { min: 0.01, max: 100, step: 0.01 }), 100);
});

test('converts canonical lots to cTrader 0.01-unit protocol volume using symbol lot size', () => {
  assert.equal(normalizeVolumeForCTrader(0.01, { lotSize: 100000, minVolume: 100000, stepVolume: 100000 }), 100000);
  assert.equal(normalizeVolumeForCTrader(0.10, { lotSize: 100000, minVolume: 100000, stepVolume: 100000 }), 1000000);
  assert.equal(normalizeVolumeForCTrader(1, { lotSize: 1, minVolume: 100, stepVolume: 100 }), 100);
});
