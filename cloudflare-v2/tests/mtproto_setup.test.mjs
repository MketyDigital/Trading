import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createExternalVmMtprotoHandoff,
  createMtprotoSetupPlan,
} from '../src/sources/mtproto/setup_contract.js';

test('external VM MTProto is handoff-only and rejects Telegram credentials', () => {
  const rejected = createMtprotoSetupPlan({
    providerType: 'external_mtproto',
    displayName: 'Existing VM source',
    sourceConnectionId: 'source-1',
    workerBaseUrl: 'https://trade.mkety.com',
    credentials: { apiId: '123', apiHash: 'abc', session: 'secret-session' },
  });

  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'EXTERNAL_MTPROTO_DOES_NOT_COLLECT_TELEGRAM_CREDENTIALS');
});

test('external VM MTProto returns source handoff details without secrets', () => {
  const result = createExternalVmMtprotoHandoff({
    sourceConnectionId: 'source-1',
    sourceExternalId: '-1001234567890',
    workerBaseUrl: 'https://trade.mkety.com/',
    internalSourceTokenName: 'INTERNAL_SOURCE_TRANSPORT_TOKEN',
  });

  assert.equal(result.ok, true);
  assert.equal(result.providerType, 'external_mtproto');
  assert.equal(result.handoff.url, 'https://trade.mkety.com/api/v1/internal/source-event');
  assert.equal(result.handoff.headers['X-Mkety-Internal-Source-Token'], '${INTERNAL_SOURCE_TRANSPORT_TOKEN}');
  assert.equal(result.handoff.payloadExample.source_id, 'source-1');
  assert.equal(result.handoff.payloadExample.source_external_id, '-1001234567890');
  assert.equal(result.credentialsRequiredByMkety.length, 0);
  assert.equal(JSON.stringify(result).includes('apiHash'), false);
  assert.equal(JSON.stringify(result).includes('session'), false);
});

test('Cloudflare container MTProto requires Telegram credentials because Mkety hosts the listener', () => {
  const missing = createMtprotoSetupPlan({
    providerType: 'cloudflare_container_mtproto',
    displayName: 'Mkety hosted listener',
    sourceConnectionId: 'source-2',
    workerBaseUrl: 'https://trade.mkety.com',
    credentials: { apiId: '123', apiHash: 'abc' },
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'MTPROTO_SESSION_REQUIRED');

  const accepted = createMtprotoSetupPlan({
    providerType: 'cloudflare_container_mtproto',
    displayName: 'Mkety hosted listener',
    sourceConnectionId: 'source-2',
    workerBaseUrl: 'https://trade.mkety.com',
    credentials: { apiId: '123', apiHash: 'abc', session: 'secret-session' },
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.providerType, 'cloudflare_container_mtproto');
  assert.equal(accepted.credentialsRequiredByMkety.includes('apiId'), true);
  assert.equal(accepted.credentialsConfigured.apiId, true);
  assert.equal(JSON.stringify(accepted).includes('secret-session'), false);
});

test('Cloudflare DO MTProto uses same Mkety-hosted credential boundary', () => {
  const accepted = createMtprotoSetupPlan({
    providerType: 'cloudflare_do_mtproto',
    displayName: 'DO listener',
    sourceConnectionId: 'source-3',
    workerBaseUrl: 'https://trade.mkety.com',
    credentials: { apiId: '123', apiHash: 'abc', session: 'secret-session' },
  });

  assert.equal(accepted.ok, true);
  assert.equal(accepted.providerType, 'cloudflare_do_mtproto');
  assert.equal(accepted.runtime.mode, 'cloudflare_do');
  assert.equal(accepted.credentialsConfigured.session, true);
});
