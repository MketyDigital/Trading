import test from 'node:test';
import assert from 'node:assert/strict';
import * as cbotProtocol from '../src/adapters/ctrader_cbot_protocol.js';
import { verifyConnectionToken } from '../../ctrader-cbot-gateway/src/protocol.js';

const {
  buildCTraderCbotEnvelope,
  validateCTraderCbotEnvelope,
  signCTraderCbotBody,
} = cbotProtocol;

test('cBot command envelope is Mkety-row-bound, broker-account-bound and expires', () => {
  const envelope = buildCTraderCbotEnvelope({
    commandId: 'cmd-1',
    workspaceId: 'ws-1',
    accountId: 'row-1',
    brokerAccountId: '12345678',
    issuedAt: 1_000,
    ttlMs: 15_000,
    command: { action: 'OPEN_POSITION', symbol: 'XAUUSD' },
  });
  assert.deepEqual(envelope, {
    version: 'mkety.ctrader.cbot.v1',
    command_id: 'cmd-1',
    workspace_id: 'ws-1',
    account_id: 'row-1',
    broker_account_id: '12345678',
    issued_at: 1_000,
    expires_at: 16_000,
    command: { action: 'OPEN_POSITION', symbol: 'XAUUSD' },
  });
  assert.deepEqual(validateCTraderCbotEnvelope(envelope, { nowMs: 5_000, expectedAccountId: 'row-1', expectedBrokerAccountId: '12345678' }), { ok: true });
  assert.deepEqual(validateCTraderCbotEnvelope(envelope, { nowMs: 16_001, expectedAccountId: 'row-1', expectedBrokerAccountId: '12345678' }), { ok: false, reason: 'EXPIRED' });
  assert.deepEqual(validateCTraderCbotEnvelope(envelope, { nowMs: 5_000, expectedAccountId: 'row-2', expectedBrokerAccountId: '12345678' }), { ok: false, reason: 'ACCOUNT_MISMATCH' });
  assert.deepEqual(validateCTraderCbotEnvelope(envelope, { nowMs: 5_000, expectedAccountId: 'row-1', expectedBrokerAccountId: '87654321' }), { ok: false, reason: 'BROKER_ACCOUNT_MISMATCH' });
});

test('cBot command signature is deterministic HMAC', async () => {
  const body = JSON.stringify({ version: 'mkety.ctrader.cbot.v1', command_id: 'cmd-1' });
  const first = await signCTraderCbotBody(body, 'shared-secret');
  const second = await signCTraderCbotBody(body, 'shared-secret');
  assert.equal(first, second);
  assert.match(first, /^v1=[a-f0-9]{64}$/);
});

test('Worker creates a gateway-compatible account-bound cBot connection token', async () => {
  assert.equal(typeof cbotProtocol.createCTraderCbotConnectionToken, 'function');
  const token = await cbotProtocol.createCTraderCbotConnectionToken({
    accountRowId: 'acct-cbot-1',
    signingKey: 'gateway-signing-key',
    issuedAt: 1_000,
    ttlMs: 60_000,
    nonce: 'nonce-1',
  });
  const verified = verifyConnectionToken(token, 'gateway-signing-key', 30_000);
  assert.equal(verified.ok, true);
  assert.equal(verified.accountRowId, 'acct-cbot-1');
  assert.equal(verified.expiresAt, 61_000);
});
