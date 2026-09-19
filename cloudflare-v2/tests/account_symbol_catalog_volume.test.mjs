import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAccountSymbolCatalog } from '../src/execution/account_symbol_catalog.js';

test('normalizes persisted cTrader protocol volumes into user-facing lots', () => {
  const [symbol] = sanitizeAccountSymbolCatalog([{
    platform: 'ctrader',
    platformSymbol: 'Volatility 75 Index',
    canonical: 'DERIV:VOLATILITY_75',
    protocolLotSize: 100,
    minVolume: 1,
    maxVolume: 5000,
    stepVolume: 1,
  }]);

  assert.equal(symbol.minLots, 0.01);
  assert.equal(symbol.maxLots, 50);
  assert.equal(symbol.stepLots, 0.01);
  assert.equal(symbol.minVolume, 1);
  assert.equal(symbol.stepVolume, 1);
});

test('does not reinterpret MT5 lot metadata as cTrader protocol volume', () => {
  const [symbol] = sanitizeAccountSymbolCatalog([{
    platform: 'mt5',
    platformSymbol: 'EURUSD',
    minVolume: 0.01,
    maxVolume: 100,
    stepVolume: 0.01,
  }]);

  assert.equal(symbol.minLots, 0.01);
  assert.equal(symbol.maxLots, 100);
  assert.equal(symbol.stepLots, 0.01);
});
