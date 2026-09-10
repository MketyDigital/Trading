import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectionToken, verifyConnectionToken, validateCommand } from '../src/protocol.js';

test('connection token is signed, scoped to account row and expires', () => {
  const token = createConnectionToken({ accountRowId: 'row-1', expiresAt: 20_000, nonce: 'abc' }, 'signing-key');
  assert.equal(token.split('.').length, 3);
  assert.deepEqual(verifyConnectionToken(token, 'signing-key', 10_000), {
    ok: true,
    accountRowId: 'row-1',
    expiresAt: 20_000,
  });
  assert.deepEqual(verifyConnectionToken(token, 'signing-key', 20_001), { ok: false, reason: 'TOKEN_EXPIRED' });
  assert.deepEqual(verifyConnectionToken(`${token}x`, 'signing-key', 10_000), { ok: false, reason: 'TOKEN_INVALID' });
});

test('gateway command validation fails closed for account mismatch, missing broker identity and expiry', () => {
  const command = {
    version: 'mkety.ctrader.cbot.v1',
    command_id: 'cmd-1',
    account_id: 'row-1',
    broker_account_id: '12345678',
    issued_at: 1000,
    expires_at: 5000,
    command: { action: 'OPEN_POSITION' },
  };
  assert.deepEqual(validateCommand(command, 'row-1', 2000), { ok: true });
  assert.deepEqual(validateCommand(command, 'row-2', 2000), { ok: false, reason: 'ACCOUNT_MISMATCH' });
  assert.deepEqual(validateCommand({ ...command, broker_account_id: '' }, 'row-1', 2000), { ok: false, reason: 'COMMAND_INVALID' });
  assert.deepEqual(validateCommand(command, 'row-1', 6000), { ok: false, reason: 'EXPIRED' });
});
