import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSymbolAgainstCatalog } from '../src/normalization/trading_normalizer.js';

test('resolves aliases and broker-specific symbols through catalog metadata', () => {
  const catalog = [
    { platformSymbol: 'XAUUSD.a', canonical: 'XAUUSD', aliases: ['GOLD'], digits: 2, tickSize: 0.01 },
    { platformSymbol: 'EURUSD.pro', canonical: 'EURUSD', aliases: ['EUR/USD'], digits: 5, tickSize: 0.00001 },
    { platformSymbol: 'US100.cash', canonical: 'NAS100', aliases: ['NASDAQ', 'USTEC'], digits: 1, tickSize: 0.1 },
    { platformSymbol: 'BTCUSD.r', canonical: 'BTCUSD', aliases: ['BITCOIN', 'BTC'] },
  ];

  assert.equal(resolveSymbolAgainstCatalog('gold', catalog).platformSymbol, 'XAUUSD.a');
  assert.equal(resolveSymbolAgainstCatalog('EUR/USD', catalog).platformSymbol, 'EURUSD.pro');
  assert.equal(resolveSymbolAgainstCatalog('nasdaq', catalog).platformSymbol, 'US100.cash');
  assert.equal(resolveSymbolAgainstCatalog('bitcoin', catalog).platformSymbol, 'BTCUSD.r');
});

test('fails closed instead of guessing when broker catalog mapping is ambiguous', () => {
  const catalog = [
    { platformSymbol: 'BTCUSD', canonical: 'BTCUSD', aliases: ['BITCOIN'] },
    { platformSymbol: 'BTCUSD.m', canonical: 'BTCUSD', aliases: ['BITCOIN'] },
  ];

  const result = resolveSymbolAgainstCatalog('bitcoin', catalog);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'AMBIGUOUS_SYMBOL');
  assert.deepEqual(result.candidates, ['BTCUSD', 'BTCUSD.m']);
});

test('returns not-found when a connected platform does not expose the requested market', () => {
  const result = resolveSymbolAgainstCatalog('XAUUSD', [
    { platformSymbol: 'EURUSD', canonical: 'EURUSD' },
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SYMBOL_NOT_FOUND');
});
