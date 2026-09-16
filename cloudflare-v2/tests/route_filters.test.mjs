import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateRouteFilters } from '../src/destinations/route_filters.js';

const broker = { destination_type: 'broker_account' };
const telegram = { destination_type: 'telegram' };
const xau = { intent: { canonicalSymbol: 'XAUUSD' } };
const v75 = { intent: { canonical_symbol: 'DERIV:VOLATILITY_75' } };

test('empty route filters preserve existing behavior', () => {
  assert.deepEqual(evaluateRouteFilters({}, xau, broker), { allowed: true, reason: null });
});

test('allowed canonical symbols permit matching broker intent and reject another symbol', () => {
  assert.equal(evaluateRouteFilters({ allowedCanonicalSymbols: ['XAUUSD'] }, xau, broker).allowed, true);
  assert.deepEqual(
    evaluateRouteFilters({ allowedCanonicalSymbols: ['XAUUSD'] }, v75, broker),
    { allowed: false, reason: 'ROUTE_FILTER_SYMBOL_NOT_ALLOWED' },
  );
});

test('blocked canonical symbols win over allow list', () => {
  assert.deepEqual(
    evaluateRouteFilters({ allowedCanonicalSymbols: ['XAUUSD'], blockedCanonicalSymbols: ['XAUUSD'] }, xau, broker),
    { allowed: false, reason: 'ROUTE_FILTER_SYMBOL_BLOCKED' },
  );
});

test('malformed broker filters fail closed', () => {
  assert.deepEqual(
    evaluateRouteFilters({ allowedCanonicalSymbols: 'XAUUSD' }, xau, broker),
    { allowed: false, reason: 'ROUTE_FILTERS_INVALID' },
  );
});

test('symbol-filtered broker route fails closed when canonical symbol is unavailable', () => {
  assert.deepEqual(
    evaluateRouteFilters({ allowedCanonicalSymbols: ['XAUUSD'] }, { intent: {} }, broker),
    { allowed: false, reason: 'ROUTE_FILTER_SYMBOL_UNAVAILABLE' },
  );
});

test('malformed/noncanonical filters never block non-broker Telegram forwarding', () => {
  assert.deepEqual(
    evaluateRouteFilters({ allowedCanonicalSymbols: 'bad-shape' }, {}, telegram),
    { allowed: true, reason: null },
  );
});
