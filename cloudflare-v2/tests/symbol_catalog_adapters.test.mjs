import test from 'node:test';
import assert from 'node:assert/strict';
import { fromMT5Symbols, fromCTraderSymbols, fromDerivActiveSymbols } from '../src/normalization/symbol_catalog.js';

test('maps MT5 symbol metadata into canonical catalog shape', () => {
  const [symbol] = fromMT5Symbols([{ name: 'XAUUSD.a', description: 'Gold vs US Dollar', digits: 2, trade_tick_size: 0.01, trade_contract_size: 100, volume_min: 0.01, volume_max: 50, volume_step: 0.01 }]);
  assert.equal(symbol.platformSymbol, 'XAUUSD.a');
  assert.equal(symbol.canonical, 'XAUUSD');
  assert.equal(symbol.lotSize, 100);
  assert.equal(symbol.minLots, 0.01);
});

test('maps cTrader account symbol metadata without double-converting protocol cents', () => {
  const [symbol] = fromCTraderSymbols([{ symbolId: 41, symbolName: 'EUR/USD', digits: 5, pipPosition: 4, lotSize: 10000000, minVolume: 100000, maxVolume: 100000000, stepVolume: 100000 }]);
  assert.equal(symbol.platformSymbol, 'EUR/USD');
  assert.equal(symbol.canonical, 'EURUSD');
  assert.equal(symbol.platformId, 41);
  assert.equal(symbol.protocolLotSize, 10000000);
  assert.equal(symbol.lotSizeUnits, 100000);
  assert.equal(symbol.minVolume, 100000);
  assert.equal(symbol.tickSize, 0.00001);
  assert.equal(symbol.pipSize, 0.0001);
});

test('maps current Deriv active-symbol metadata into canonical catalog shape', () => {
  const [symbol] = fromDerivActiveSymbols([{ underlying_symbol: '1HZ75V', underlying_symbol_name: 'Volatility 75 (1s) Index', pip_size: 0.01, underlying_symbol_type: 'synthetic_index' }]);
  assert.equal(symbol.platformSymbol, '1HZ75V');
  assert.equal(symbol.canonical, 'DERIV:VOLATILITY_75_1S');
  assert.equal(symbol.tickSize, 0.01);
});
