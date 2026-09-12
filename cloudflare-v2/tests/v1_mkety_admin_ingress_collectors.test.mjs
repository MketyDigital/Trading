import test from 'node:test';
import assert from 'node:assert/strict';

import { handleMketyAdminIngressCollectorsRequest } from '../src/http/v1_mkety_admin_ingress_collectors.js';

function memoryStore() {
  const rows = new Map();
  return {
    rows,
    async listCollectors() { return [...rows.values()]; },
    async createCollector(record) { rows.set(record.id, record); return record; },
    async rotateCollector(id, tokenHash) {
      const current = rows.get(id);
      if (!current) return null;
      const next = { ...current, token_hash: tokenHash, updated_at: new Date().toISOString() };
      rows.set(id, next);
      return next;
    },
    async setCollectorActive(id, enabled) {
      const current = rows.get(id);
      if (!current) return null;
      const next = { ...current, is_active: enabled };
      rows.set(id, next);
      return next;
    },
  };
}

function request(path, method = 'GET', body = undefined) {
  return new Request(`https://trade.mkety.com${path}`, {
    method,
    headers: {
      'X-Mkety-Admin-Secret': 'admin-secret',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test('collector admin creates one-time token and recommends clean bearer endpoint', async () => {
  const store = memoryStore();
  const env = { MKETY_TRADING_ADMIN_SECRET: 'admin-secret' };
  const created = await handleMketyAdminIngressCollectorsRequest(
    request('/api/v1/mkety-admin/ingress-collectors', 'POST', { name: 'OCI shared Telegram', externalIdentity: 'telegram-account-1' }),
    env,
    { store, randomToken: () => 'collector-secret-token', randomUUID: () => 'collector-uuid' },
  );
  assert.equal(created.status, 201);
  const payload = await created.json();
  assert.equal(payload.collector.id, 'collector-uuid');
  assert.equal(payload.oneTimeToken, 'collector-secret-token');
  assert.equal(payload.endpointUrl, 'https://trade.mkety.com/api/v1/external/mtproto/collect');
  assert.equal(payload.endpointUrl.includes(payload.oneTimeToken), false);
  assert.equal(store.rows.get('collector-uuid').token_hash.length, 64);
  assert.notEqual(store.rows.get('collector-uuid').token_hash, 'collector-secret-token');

  const listed = await handleMketyAdminIngressCollectorsRequest(
    request('/api/v1/mkety-admin/ingress-collectors'), env, { store },
  );
  const listPayload = await listed.json();
  assert.equal(listPayload.collectors.length, 1);
  assert.equal('token_hash' in listPayload.collectors[0], false);
  assert.equal('oneTimeToken' in listPayload.collectors[0], false);
});

test('collector admin rotates token while preserving clean endpoint and can revoke', async () => {
  const store = memoryStore();
  store.rows.set('c1', {
    id: 'c1', collector_name: 'Shared listener', token_hash: 'old-hash', is_active: true,
    metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  const env = { MKETY_TRADING_ADMIN_SECRET: 'admin-secret' };
  const rotated = await handleMketyAdminIngressCollectorsRequest(
    request('/api/v1/mkety-admin/ingress-collectors/c1/rotate', 'POST'), env,
    { store, randomToken: () => 'new-token' },
  );
  const rotatePayload = await rotated.json();
  assert.equal(rotatePayload.oneTimeToken, 'new-token');
  assert.equal(rotatePayload.endpointUrl, 'https://trade.mkety.com/api/v1/external/mtproto/collect');
  assert.equal(rotatePayload.endpointUrl.includes(rotatePayload.oneTimeToken), false);
  assert.equal(store.rows.get('c1').token_hash.length, 64);

  const revoked = await handleMketyAdminIngressCollectorsRequest(
    request('/api/v1/mkety-admin/ingress-collectors/c1/revoke', 'POST'), env, { store },
  );
  assert.equal(revoked.status, 200);
  assert.equal(store.rows.get('c1').is_active, false);
});

test('collector admin rejects missing/wrong Mkety admin secret', async () => {
  const response = await handleMketyAdminIngressCollectorsRequest(
    new Request('https://trade.mkety.com/api/v1/mkety-admin/ingress-collectors'),
    { MKETY_TRADING_ADMIN_SECRET: 'admin-secret' },
    { store: memoryStore() },
  );
  assert.equal(response.status, 401);
});
