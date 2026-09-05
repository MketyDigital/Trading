import test from 'node:test';
import assert from 'node:assert/strict';

import { handleV1AdminRequest } from '../src/http/v1_admin.js';
import { createAdminSourceStore } from '../src/http/v1_admin_sources.js';
import { decryptSecret } from '../src/security/secret_box.js';

const masterKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function workspaceQuery(workspace) {
  return {
    from(table) {
      assert.equal(table, 'trading_workspace_access');
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        maybeSingle: async () => ({ data: workspace, error: null }),
      };
      return chain;
    },
  };
}

function membership() {
  return () => ({
    async getMembership(workspaceId, subject) {
      return { id: 'm1', workspaceId, subject, role: 'owner', enabled: true, metadata: {} };
    },
  });
}

test('production admin router passes server env into source-store factory', async () => {
  const env = {
    MKETY_ACCESS_ISSUER: 'https://access.mkety.test',
    MKETY_ACCESS_AUDIENCE: 'mkety-trading',
    MKETY_ACCESS_JWKS_URL: 'https://access.mkety.test/.well-known/jwks.json',
    TRADING_MASTER_KEY: masterKey,
  };
  let receivedEnv = null;

  const response = await handleV1AdminRequest(new Request('https://trade.test/api/v1/admin/sources', {
    headers: {
      'X-Mkety-Workspace-Id': '11111111-1111-4111-8111-111111111111',
      Authorization: 'Bearer fixture',
    },
  }), env, {
    supabaseFactory: async () => workspaceQuery({
      id: '11111111-1111-4111-8111-111111111111',
      trading_access_enabled: true,
    }),
    authenticateFn: async () => ({
      ok: true,
      subject: 'owner-1',
      workspaceId: '11111111-1111-4111-8111-111111111111',
      access: 'owner',
    }),
    membershipStoreFactory: membership(),
    sourceStoreFactory: (_supabase, runtimeEnv) => {
      receivedEnv = runtimeEnv;
      return { async listSources() { return []; } };
    },
  });

  assert.equal(response.status, 200);
  assert.equal(receivedEnv, env);
});

test('production source store creates inactive row with independent encrypted ingress secret and provider envelope', async () => {
  let inserted = null;
  const supabase = {
    from(table) {
      assert.equal(table, 'source_connections');
      const chain = {
        insert(row) { inserted = row; return chain; },
        select() { return chain; },
        maybeSingle: async () => ({
          data: {
            ...inserted,
            id: '22222222-2222-4222-8222-222222222222',
            restart_count: 0,
          },
          error: null,
        }),
      };
      return chain;
    },
  };

  const store = createAdminSourceStore(supabase, { TRADING_MASTER_KEY: masterKey });
  const source = await store.createSource('11111111-1111-4111-8111-111111111111', {
    providerType: 'cloudflare_container_mtproto',
    sourceFamily: 'telegram',
    sourceType: 'telegram_mtproto',
    sourceInstanceId: 'telegram-primary',
    displayName: 'Primary Telegram',
    externalIdentity: 'telegram-user-fixture',
    priority: 10,
    enabled: false,
    config: { chat_ids: ['fixture-chat-id'] },
    providerSecretCiphertext: 'fixture-provider-envelope',
  });

  assert.equal(inserted.workspace_id, '11111111-1111-4111-8111-111111111111');
  assert.equal(inserted.is_active, false);
  assert.equal(inserted.is_default, false);
  assert.equal(inserted.provider_secret_ciphertext, 'fixture-provider-envelope');
  assert.equal(typeof inserted.secret_ciphertext, 'string');
  assert.notEqual(inserted.secret_ciphertext, inserted.provider_secret_ciphertext);
  const ingressSecret = await decryptSecret(inserted.secret_ciphertext, masterKey);
  assert.equal(typeof ingressSecret, 'string');
  assert.ok(ingressSecret.length >= 32);
  assert.equal(source.enabled, false);
});

test('production source credential replacement is exact-workspace/id scoped and does not rotate ingress secret', async () => {
  let updatePayload = null;
  const predicates = [];
  const supabase = {
    from(table) {
      assert.equal(table, 'source_connections');
      const chain = {
        update(row) { updatePayload = row; return chain; },
        eq(column, value) { predicates.push([column, value]); return chain; },
        select() { return chain; },
        maybeSingle: async () => ({
          data: {
            id: '22222222-2222-4222-8222-222222222222',
            workspace_id: '11111111-1111-4111-8111-111111111111',
            source_type: 'telegram_mtproto',
            source_instance_id: 'telegram-primary',
            display_name: 'Primary Telegram',
            secret_ciphertext: 'existing-ingress-envelope',
            source_family: 'telegram',
            provider_type: 'cloudflare_container_mtproto',
            provider_secret_ciphertext: updatePayload.provider_secret_ciphertext,
            is_active: false,
            is_default: false,
            priority: 10,
            external_identity: 'telegram-user-fixture',
            config: {},
            health_status: 'DISABLED',
            restart_count: 0,
          },
          error: null,
        }),
      };
      return chain;
    },
  };

  const store = createAdminSourceStore(supabase, { TRADING_MASTER_KEY: masterKey });
  await store.replaceSourceCredentials(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'replacement-provider-envelope',
  );

  assert.deepEqual(updatePayload, { provider_secret_ciphertext: 'replacement-provider-envelope' });
  assert.deepEqual(predicates, [
    ['workspace_id', '11111111-1111-4111-8111-111111111111'],
    ['id', '22222222-2222-4222-8222-222222222222'],
  ]);
  assert.equal('secret_ciphertext' in updatePayload, false);
});
