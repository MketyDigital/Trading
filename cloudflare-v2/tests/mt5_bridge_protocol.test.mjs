import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMT5BridgeEnvelope,
  signMT5BridgeBody,
  verifyMT5BridgeSignature,
  validateMT5BridgeEnvelope,
} from '../src/adapters/mt5_bridge_protocol.js';

test('builds versioned idempotent mt5 command envelope', () => {
  const envelope = buildMT5BridgeEnvelope({
    commandId: 'cmd-1', workspaceId: 'ws-1', accountId: 'acct-1',
    issuedAt: 1000, ttlMs: 5000,
    command: { action: 'OPEN_POSITION', symbol: 'XAUUSD.a', volume: 0.03 },
  });
  assert.deepEqual(envelope, {
    version: 'mkety.mt5.v1', command_id: 'cmd-1', workspace_id: 'ws-1', account_id: 'acct-1',
    issued_at: 1000, expires_at: 6000,
    command: { action: 'OPEN_POSITION', symbol: 'XAUUSD.a', volume: 0.03 },
  });
});

test('signs and verifies exact raw json body with hmac sha256', async () => {
  const body = JSON.stringify({ version: 'mkety.mt5.v1', command_id: 'cmd-1' });
  const signature = await signMT5BridgeBody(body, 'shared-secret');
  assert.match(signature, /^v1=[0-9a-f]{64}$/);
  assert.equal(await verifyMT5BridgeSignature(body, 'shared-secret', signature), true);
  assert.equal(await verifyMT5BridgeSignature(body + ' ', 'shared-secret', signature), false);
  assert.equal(await verifyMT5BridgeSignature(body, 'wrong-secret', signature), false);
});

test('rejects stale, future, malformed or unscoped commands before execution', () => {
  const valid = buildMT5BridgeEnvelope({
    commandId: 'cmd-2', workspaceId: 'ws-1', accountId: 'acct-1', issuedAt: 1000, ttlMs: 5000,
    command: { action: 'CLOSE_POSITION', positionId: '77' },
  });
  assert.deepEqual(validateMT5BridgeEnvelope(valid, { nowMs: 3000 }), { ok: true });
  assert.equal(validateMT5BridgeEnvelope(valid, { nowMs: 7000 }).ok, false);
  assert.equal(validateMT5BridgeEnvelope({ ...valid, issued_at: 9000 }, { nowMs: 3000 }).ok, false);
  assert.equal(validateMT5BridgeEnvelope({ ...valid, workspace_id: '' }, { nowMs: 3000 }).ok, false);
  assert.equal(validateMT5BridgeEnvelope({ ...valid, command_id: '' }, { nowMs: 3000 }).ok, false);
});
