import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCTraderCbotEnvelope,
  validateCTraderCbotEnvelope,
  signCTraderCbotBody,
} from '../src/adapters/ctrader_cbot_protocol.js';

test('cBot command envelope is account-bound and expires', () => {
  const envelope = buildCTraderCbotEnvelope({
    commandId: 'cmd-1',
    workspaceId: 'ws-1',
    accountId: 'row-1',
    issuedAt: 1_000,
    ttlMs: 15_000,
    command: { action: 'OPEN_POSITION', symbol: 'XAUUSD' },
  });
  assert.deepEqual(envelope, {
    version: 'mkety.ctrader.cbot.v1',
    command_id: 'cmd-1',
    workspace_id: 'ws-1',
    account_id: 'row-1',
    issued_at: 1_000,
    expires_at: 16_000,
    command: { action: 'OPEN_POSITION', symbol: 'XAUUSD' },
  });
  assert.deepEqual(validateCTraderCbotEnvelope(envelope, { nowMs: 5_000, expectedAccountId: 'row-1' }), { ok: true });
  assert.deepEqual(validateCTraderCbotEnvelope(envelope, { nowMs: 16_001, expectedAccountId: 'row-1' }), { ok: false, reason: 'EXPIRED' });
  assert.deepEqual(validateCTraderCbotEnvelope(envelope, { nowMs: 5_000, expectedAccountId: 'row-2' }), { ok: false, reason: 'ACCOUNT_MISMATCH' });
});

test('cBot command signature is deterministic HMAC', async () => {
  const body = JSON.stringify({ version: 'mkety.ctrader.cbot.v1', command_id: 'cmd-1' });
  const first = await signCTraderCbotBody(body, 'shared-secret');
  const second = await signCTraderCbotBody(body, 'shared-secret');
  assert.equal(first, second);
  assert.match(first, /^v1=[a-f0-9]{64}$/);
});
