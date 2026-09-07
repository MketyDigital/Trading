import test from 'node:test';
import assert from 'node:assert/strict';
import { signSourcePayload, verifySignedSourcePayload } from '../src/security/source_auth.js';

test('accepts valid source hmac within timestamp window', async () => {
  const rawBody = JSON.stringify({ external_event_id: '123', text: 'BUY XAUUSD' });
  const signature = await signSourcePayload(rawBody, '1700000000000', 'secret');
  const result = await verifySignedSourcePayload({
    rawBody, sourceId: 'telegram-node-1', timestamp: '1700000000000', signature, secret: 'secret', nowMs: 1700000005000,
  });
  assert.deepEqual(result, { ok: true, sourceId: 'telegram-node-1' });
});

test('rejects tampering, wrong secret and stale or future requests', async () => {
  const rawBody = '{"text":"BUY GOLD"}';
  const timestamp = '1700000000000';
  const signature = await signSourcePayload(rawBody, timestamp, 'secret');
  assert.equal((await verifySignedSourcePayload({ rawBody: rawBody + ' ', sourceId: 's1', timestamp, signature, secret: 'secret', nowMs: 1700000001000 })).ok, false);
  assert.equal((await verifySignedSourcePayload({ rawBody, sourceId: 's1', timestamp, signature, secret: 'wrong', nowMs: 1700000001000 })).ok, false);
  assert.equal((await verifySignedSourcePayload({ rawBody, sourceId: 's1', timestamp, signature, secret: 'secret', nowMs: 1700001000000, maxSkewMs: 30000 })).reason, 'STALE_TIMESTAMP');
  assert.equal((await verifySignedSourcePayload({ rawBody, sourceId: 's1', timestamp: '1700001000000', signature: await signSourcePayload(rawBody, '1700001000000', 'secret'), secret: 'secret', nowMs: 1700000000000, maxSkewMs: 30000 })).reason, 'FUTURE_TIMESTAMP');
});

test('requires source identity and signature fields', async () => {
  const result = await verifySignedSourcePayload({ rawBody: '{}', sourceId: '', timestamp: '', signature: '', secret: 'secret', nowMs: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'MISSING_AUTH_FIELDS');
});
