import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveAccountSymbol,
  sanitizeAccountSymbolCatalog,
  mergeAccountSymbolAliases,
} from '../src/execution/account_symbol_catalog.js';

const catalog = [
  { platformSymbol: 'XAUUSD.r', canonical: 'XAUUSD', aliases: ['GOLD'], minVolume: 0.01, maxVolume: 100, stepVolume: 0.01 },
  { platformSymbol: 'Volatility 75 Index', canonical: 'DERIV:VOLATILITY_75', aliases: ['V75'] },
  { platformSymbol: 'US30.cash', canonical: 'US30', aliases: ['DOW'] },
];

test('exact platform symbol wins before normalized/canonical matching', () => {
  const result = resolveAccountSymbol('XAUUSD.r', catalog, {});
  assert.equal(result.ok, true);
  assert.equal(result.platformSymbol, 'XAUUSD.r');
  assert.equal(result.matchType, 'exact_platform');
});

test('explicit account alias resolves to its configured platform symbol', () => {
  const result = resolveAccountSymbol('mygold', catalog, { MYGOLD: 'XAUUSD.r' });
  assert.equal(result.ok, true);
  assert.equal(result.platformSymbol, 'XAUUSD.r');
  assert.equal(result.matchType, 'explicit_alias');
});

test('canonical and broker-provided aliases resolve generically across instrument types', () => {
  assert.equal(resolveAccountSymbol('gold', catalog, {}).platformSymbol, 'XAUUSD.r');
  assert.equal(resolveAccountSymbol('Volatility 75', catalog, {}).platformSymbol, 'Volatility 75 Index');
  assert.equal(resolveAccountSymbol('V75', catalog, {}).platformSymbol, 'Volatility 75 Index');
  assert.equal(resolveAccountSymbol('DOW', catalog, {}).platformSymbol, 'US30.cash');
});

test('ambiguous normalized matches fail closed instead of guessing broker symbol', () => {
  const result = resolveAccountSymbol('gold', [
    { platformSymbol: 'XAUUSD.a', canonical: 'XAUUSD', aliases: ['GOLD'] },
    { platformSymbol: 'XAUUSD.b', canonical: 'XAUUSD', aliases: ['GOLD'] },
  ], {});
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'AMBIGUOUS_SYMBOL');
  assert.deepEqual(result.candidates.sort(), ['XAUUSD.a', 'XAUUSD.b']);
});

test('explicit alias must point to a symbol actually advertised by the connected account', () => {
  const result = resolveAccountSymbol('special', catalog, { SPECIAL: 'NOT-OFFERED' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SYMBOL_ALIAS_TARGET_NOT_FOUND');
});

test('catalog sanitizer removes secrets/unknown fields, drops invalid rows and bounds size', () => {
  const input = Array.from({ length: 2100 }, (_, index) => ({
    platformSymbol: `SYM${index}`,
    canonical: `SYM${index}`,
    description: `Symbol ${index}`,
    tradable: true,
    minVolume: 0.01,
    maxVolume: 10,
    stepVolume: 0.01,
    password: 'never',
    token: 'never',
  }));
  input.unshift({ platformSymbol: '', canonical: 'INVALID' });
  const safe = sanitizeAccountSymbolCatalog(input);
  assert.equal(safe.length, 2000);
  assert.equal('password' in safe[0], false);
  assert.equal('token' in safe[0], false);
  assert.ok(safe.every((item) => item.platformSymbol));
});

test('account alias merge normalizes alias keys and rejects empty targets', () => {
  assert.deepEqual(mergeAccountSymbolAliases({ ' my gold ': 'XAUUSD.r', V75: 'Volatility 75 Index', bad: '' }), {
    MYGOLD: 'XAUUSD.r',
    V75: 'Volatility 75 Index',
  });
});
