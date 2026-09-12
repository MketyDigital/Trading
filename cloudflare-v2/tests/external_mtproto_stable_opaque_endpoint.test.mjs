import test from 'node:test';
import assert from 'node:assert/strict';

import { handleExternalMtprotoEndpointRequest } from '../src/http/external_mtproto_endpoint.js';
import { handleAuthorizedV1AdminSourcesRequest } from '../src/http/v1_admin_sources.js';
import { handleV1AdminConnectionsRequest } from '../src/http/v1_admin_connections.js';

const authorization = {
  workspace: { id: 'ws-1', trading_access_enabled: true },
  auth: { subject: 'owner-1' },
  membership: { workspaceId: 'ws-1', subject: 'owner-1', role: 'owner', enabled: true },
};

function externalSource(overrides = {}) {
  return {
    id: 'source-1',
    workspaceId: 'ws-1',
    providerType: 'external_mtproto',
    sourceFamily: 'telegram',
    sourceType: 'telegram_mtproto',
    sourceInstanceId: 'external-userbot',
    displayName: 'External Telegram Userbot',
    enabled: true,
    isDefault: false,
    priority: 0,
    externalIdentity: null,
    publicSourceHandle: 'stable-opaque-handle-123',
    config: { chat_acceptance_mode: 'allowlist', allowed_chat_ids: ['-1003902892609'] },
    credentialConfigured: false,
    health: { status: 'READY' },
    ...overrides,
  };
}

test('external MTProto stable opaque URL authenticates without Mkety headers and forwards the payload', async () => {
  let forwarded = null;
  const response = await handleExternalMtprotoEndpointRequest(
    new Request('https://trade.mkety.com/api/v1/external/mtproto/source-1/stable-opaque-handle-123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: '-1003902892609', message_id: 222, text: 'BUY XAUUSD NOW' }),
    }),
    { TRADING_MASTER_KEY: 'master' },
    {
      resolveActiveSource: async () => ({
        id: 'source-1',
        provider_type: 'external_mtproto',
        public_source_handle: 'stable-opaque-handle-123',
        secret: 'legacy-secret-still-supported',
      }),
      eventsHandler: async (request) => {
        forwarded = JSON.parse(await request.text());
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(forwarded.text, 'BUY XAUUSD NOW');
  assert.equal(forwarded.external_event_id, 'telegram:-1003902892609:222');
});

test('new external MTProto sources receive a durable random public handle in addition to the legacy one-time URL', async () => {
  let createdInput = null;
  const sourceStore = {
    async createSource(workspaceId, input) {
      assert.equal(workspaceId, 'ws-1');
      createdInput = input;
      return externalSource({
        id: 'source-1',
        enabled: false,
        publicSourceHandle: input.publicSourceHandle,
        health: { status: 'DISABLED' },
      });
    },
  };

  const response = await handleAuthorizedV1AdminSourcesRequest(
    new Request('https://trade.mkety.com/api/v1/admin/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerType: 'external_mtproto',
        sourceFamily: 'telegram',
        sourceType: 'telegram_mtproto',
        sourceInstanceId: 'external-userbot',
        displayName: 'External Telegram Userbot',
      }),
    }),
    authorization,
    {
      sourceStore,
      env: { TRADING_CANONICAL_HOSTS: 'trade.mkety.com', TRADING_MASTER_KEY: 'configured' },
      generatePublicSourceHandle: () => 'stable-opaque-handle-123',
      generateIngressSecret: () => 'legacy-secret-still-supported',
      encryptIngressSecret: async () => 'v1.encrypted-ingress-secret',
    },
  );

  assert.equal(response.status, 201);
  assert.equal(createdInput.publicSourceHandle, 'stable-opaque-handle-123');
  const body = await response.json();
  assert.equal(body.source.publicSourceHandle, 'stable-opaque-handle-123');
  assert.equal(
    body.oneTimeEndpointUrl,
    'https://trade.mkety.com/api/v1/external/mtproto/source-1/legacy-secret-still-supported',
  );
});

test('connections API returns the complete stable opaque external MTProto endpoint instead of a source-id-only URL', async () => {
  const row = {
    id: 'source-1',
    workspace_id: 'ws-1',
    source_type: 'telegram_mtproto',
    source_instance_id: 'external-userbot',
    display_name: 'External Telegram Userbot',
    is_active: true,
    source_family: 'telegram',
    provider_type: 'external_mtproto',
    is_default: false,
    priority: 0,
    external_identity: null,
    public_source_handle: 'stable-opaque-handle-123',
    config: {},
    provider_secret_ciphertext: null,
    health_status: 'READY',
  };

  const query = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() { return { data: row, error: null }; },
  };
  const supabase = { from(table) { assert.equal(table, 'source_connections'); return query; } };

  const response = await handleV1AdminConnectionsRequest(
    new Request('https://trade.mkety.com/api/v1/admin/connections/sources/source-1'),
    { TRADING_CANONICAL_HOSTS: 'trade.mkety.com' },
    {
      supabaseFactory: async () => supabase,
      authorizeFn: async () => ({
        ok: true,
        workspace: { id: 'ws-1' },
        auth: { subject: 'owner-1' },
        membership: { role: 'owner' },
      }),
    },
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(
    body.source.endpointUrl,
    'https://trade.mkety.com/api/v1/external/mtproto/source-1/stable-opaque-handle-123',
  );
  assert.equal(body.source.ingressAuthenticationConfigured, true);
});
