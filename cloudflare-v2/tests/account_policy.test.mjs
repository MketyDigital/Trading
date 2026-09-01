import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAccountPolicy } from '../src/execution/account_policy.js';

const base = {
  enabled: true,
  killSwitch: false,
  allowedSymbols: ['XAUUSD', 'EURUSD'],
  maxLotsPerTrade: 0.5,
  maxRiskPercent: 2,
  maxDailyLossPercent: 5,
  maxOpenRiskPercent: 6,
};

const request = {
  symbol: 'XAUUSD',
  totalLots: 0.1,
  riskPercent: 1,
  currentDailyPnlPercent: -1,
  currentOpenRiskPercent: 2,
};

test('allows an execution inside all account safety limits', () => {
  assert.deepEqual(evaluateAccountPolicy(base, request), { allowed: true, reasons: [] });
});

test('kill switch and disabled account fail closed', () => {
  assert.equal(evaluateAccountPolicy({ ...base, killSwitch: true }, request).allowed, false);
  assert.equal(evaluateAccountPolicy({ ...base, enabled: false }, request).allowed, false);
});

test('rejects symbols outside the account allowlist', () => {
  const result = evaluateAccountPolicy(base, { ...request, symbol: 'BTCUSD' });
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.includes('SYMBOL_NOT_ALLOWED'));
});

test('rejects trade lots or risk above configured account limits', () => {
  assert.ok(evaluateAccountPolicy(base, { ...request, totalLots: 0.6 }).reasons.includes('MAX_LOTS_EXCEEDED'));
  assert.ok(evaluateAccountPolicy(base, { ...request, riskPercent: 2.1 }).reasons.includes('MAX_RISK_EXCEEDED'));
});

test('locks new entries after daily loss or exposure cap is reached', () => {
  assert.ok(evaluateAccountPolicy(base, { ...request, currentDailyPnlPercent: -5 }).reasons.includes('DAILY_LOSS_LIMIT'));
  assert.ok(evaluateAccountPolicy(base, { ...request, currentOpenRiskPercent: 5.5, riskPercent: 1 }).reasons.includes('OPEN_RISK_LIMIT'));
});

test('close/protective management remains allowed under loss lock unless kill switch explicitly blocks all actions', () => {
  const result = evaluateAccountPolicy(base, { ...request, actionKind: 'REDUCE_RISK', currentDailyPnlPercent: -10 });
  assert.equal(result.allowed, true);
});
