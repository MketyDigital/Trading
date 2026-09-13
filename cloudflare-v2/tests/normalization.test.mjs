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

test('normalizes major market families and named Deriv synthetics', () => {
  const cases = [
    ['EURUSD', 'EURUSD'],
    ['GBP/JPY', 'GBPJPY'],
    ['XAUUSD', 'XAUUSD'],
    ['SILVER', 'XAGUSD'],
    ['BTCUSD', 'BTCUSD'],
    ['ETHUSD', 'ETHUSD'],
    ['US30', 'US30'],
    ['NAS100', 'NAS100'],
    ['US500', 'US500'],
    ['GER40', 'GER40'],
    ['UK100', 'UK100'],
    ['JP225', 'JP225'],
    ['HK50', 'HK50'],
    ['USOIL', 'USOIL'],
    ['UKOIL', 'UKOIL'],
    ['Volatility 75 Index', 'DERIV:VOLATILITY_75'],
    ['Volatility 75 (1s) Index', 'DERIV:VOLATILITY_75_1S'],
    ['Boom 1000 Index', 'DERIV:BOOM_1000'],
    ['Crash 500 Index', 'DERIV:CRASH_500'],
    ['Step Index', 'DERIV:STEP'],
    ['Jump 25 Index', 'DERIV:JUMP_25'],
  ];

  for (const [input, canonical] of cases) {
    assert.equal(normalizeSymbol(input).canonical, canonical, input);
  }
});

test('canonical Deriv symbols are idempotent through shared normalization', () => {
  for (const canonical of [
    'DERIV:VOLATILITY_75',
    'DERIV:VOLATILITY_75_1S',
    'DERIV:BOOM_1000',
    'DERIV:CRASH_500',
    'DERIV:STEP',
    'DERIV:JUMP_25',
  ]) {
    assert.equal(normalizeSymbol(canonical).canonical, canonical, canonical);
  }
});

test('normalizes common broker suffixes without changing canonical intent', () => {
  assert.equal(normalizeSymbol('XAUUSD.m').canonical, 'XAUUSD');
  assert.equal(normalizeSymbol('BTCUSD.pro').canonical, 'BTCUSD');
  assert.equal(normalizeSymbol('EURUSD.raw').canonical, 'EURUSD');
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

test('converts canonical lots to cTrader protocol cents using raw ProtoOASymbol lotSize', () => {
  // ProtoOASymbol.lotSize is already in cents: 10,000,000 = 100,000.00 base units per lot.
  assert.equal(normalizeVolumeForCTrader(0.01, { protocolLotSize: 10000000, minVolume: 100000, stepVolume: 100000 }), 100000);
  assert.equal(normalizeVolumeForCTrader(0.10, { protocolLotSize: 10000000, minVolume: 100000, stepVolume: 100000 }), 1000000);
  // One-unit contract: 1 lot = 1.00 unit = 100 protocol cents.
  assert.equal(normalizeVolumeForCTrader(1, { protocolLotSize: 100, minVolume: 100, stepVolume: 100 }), 100);
});
