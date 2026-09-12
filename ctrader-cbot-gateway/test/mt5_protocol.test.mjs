import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMt5ReconnectToken,
  createMt5TokenForTest,
  verifyMt5ConnectionToken,
} from '../src/mt5_protocol.js';

test('MT5 pair and reconnect tokens are purpose-scoped and reconnect is connector-instance bound', () => {
  const pair = createMt5TokenForTest({ accountRowId: 'row-1', expiresAt: 20_000, nonce: 'pair-1' }, 'signing-key');
  assert.match(pair, /^mt5v1\./);
  assert.deepEqual(verifyMt5ConnectionToken(pair, 'signing-key', 10_000), {
    ok: true,
    accountRowId: 'row-1',
    expiresAt: 20_000,
    purpose: 'pair',
    connectorInstanceId: null,
  });

  const reconnect = createMt5ReconnectToken({
    accountRowId: 'row-1',
    connectorInstanceId: 'pc-1',
    expiresAt: 30_000,
    nonce: 'reconnect-1',
  }, 'signing-key');
  assert.match(reconnect, /^mt5r1\./);
  assert.deepEqual(verifyMt5ConnectionToken(reconnect, 'signing-key', 10_000), {
    ok: true,
    accountRowId: 'row-1',
    expiresAt: 30_000,
    purpose: 'reconnect',
    connectorInstanceId: 'pc-1',
  });
});

test('MT5 auth tokens fail closed on expiry and tampering', () => {
  const token = createMt5TokenForTest({ accountRowId: 'row-1', expiresAt: 20_000, nonce: 'pair-2' }, 'signing-key');
  assert.deepEqual(verifyMt5ConnectionToken(token, 'signing-key', 20_001), { ok: false, reason: 'TOKEN_EXPIRED' });
  assert.deepEqual(verifyMt5ConnectionToken(`${token}x`, 'signing-key', 10_000), { ok: false, reason: 'TOKEN_INVALID' });
});
