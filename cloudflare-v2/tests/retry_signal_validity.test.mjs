import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateRetrySignalValidity } from '../src/execution/retry_signal_validity.js';

test('BUY retry is cancelled after SL or TP boundary is crossed', () => {
  const action = { type: 'OPEN_POSITION', side: 'BUY', stopLoss: 2490, takeProfit: 2510 };
  assert.equal(evaluateRetrySignalValidity(action, 2489).code, 'RETRY_SIGNAL_STOP_ALREADY_CROSSED');
  assert.equal(evaluateRetrySignalValidity(action, 2511).code, 'RETRY_SIGNAL_TARGET_ALREADY_CROSSED');
  assert.equal(evaluateRetrySignalValidity(action, 2500).allowed, true);
});

test('SELL retry is cancelled after SL or TP boundary is crossed', () => {
  const action = { type: 'OPEN_POSITION', side: 'SELL', stopLoss: 2510, takeProfit: 2490 };
  assert.equal(evaluateRetrySignalValidity(action, 2511).code, 'RETRY_SIGNAL_STOP_ALREADY_CROSSED');
  assert.equal(evaluateRetrySignalValidity(action, 2489).code, 'RETRY_SIGNAL_TARGET_ALREADY_CROSSED');
  assert.equal(evaluateRetrySignalValidity(action, 2500).allowed, true);
});

test('unprotected OPEN relies on bounded age and does not require a quote', () => {
  const result = evaluateRetrySignalValidity({ type: 'OPEN_POSITION', side: 'BUY' }, null);
  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'NO_PROTECTION_BOUNDARY');
});

test('management retries are not blocked by entry-signal SL/TP validity', () => {
  const result = evaluateRetrySignalValidity({ type: 'CLOSE_POSITION' }, null);
  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'NOT_OPEN_POSITION');
});
