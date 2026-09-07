import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveMtprotoContainerBootstrap } from '../src/sources/mtproto/container_bootstrap.js';

function supabaseWith(row) {
  const calls = [];
  const query = {
    select(columns) { calls.push(['select', columns]); return this; },
    eq(column, value) { calls.push(['eq', column, value]); return this; },
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return {
    calls,
    from(table) {
      calls.push(['from', table]);
      return query;
    },
  };
}

const encrypted = 'v1.fake.provider.secret';
const providerSecret = JSON.stringify({
  api_id: 123456,
  api_hash: 'telegram-api-hash',
  session_string: 'telegram-session',
});

test('resolves only exact workspace/source container provider and decrypts provider credential server-side', async () => {
  const supabase = supabaseWith({
    id: 'source-a',
    workspace_id: 'workspace-a',
    provider_type: 'cloudflare_container_mtproto',
    source_family: 'telegram',
    external_identity: 'tg-account-1',
    is_active: true,
    config: { chat_ids: ['-1001', '-1002'] },
    provider_secret_ciphertext: encrypted,
  });
  const decryptCalls = [];

  const result = await resolveMtprotoContainerBootstrap({
    supabase,
    workspaceId: 'workspace-a',
    sourceId: 'source-a',
    masterKey: 'master-key',
    internalSourceUrl: 'https://trade.example/api/v1/internal/source-event',
    internalSourceToken: 'internal-token',
    decryptFn: async (ciphertext, key) => {
      decryptCalls.push([ciphertext, key]);
      return providerSecret;
    },
  });

  assert.deepEqual(result.identity, {
    sourceId: 'source-a',
    workspaceId: 'workspace-a',
    accountScope: 'tg-account-1',
  });
  assert.deepEqual(result.bootstrap, {
    apiId: 123456,
    apiHash: 'telegram-api-hash',
    sessionString: 'telegram-session',
    chatIds: ['-1001', '-1002'],
    internalSourceUrl: 'https://trade.example/api/v1/internal/source-event',
    internalSourceToken: 'internal-token',
  });
  assert.deepEqual(decryptCalls, [[encrypted, 'master-key']]);
  assert.ok(supabase.calls.some((call) => call[0] === 'eq' && call[1] === 'workspace_id' && call[2] === 'workspace-a'));
  assert.ok(supabase.calls.some((call) => call[0] === 'eq' && call[1] === 'id' && call[2] === 'source-a'));
  assert.ok(supabase.calls.some((call) => call[0] === 'eq' && call[1] === 'provider_type' && call[2] === 'cloudflare_container_mtproto'));
  assert.ok(supabase.calls.some((call) => call[0] === 'eq' && call[1] === 'is_active' && call[2] === true));
});

test('fails closed for wrong tenant/provider, absent encrypted credentials or malformed provider secret', async () => {
  const missing = supabaseWith(null);
  await assert.rejects(() => resolveMtprotoContainerBootstrap({
    supabase: missing,
    workspaceId: 'workspace-a', sourceId: 'source-a', masterKey: 'key',
    internalSourceUrl: 'https://trade.example/internal', internalSourceToken: 'token',
    decryptFn: async () => providerSecret,
  }), /MTPROTO_SOURCE_NOT_AVAILABLE/);

  const noSecret = supabaseWith({
    id: 'source-a', workspace_id: 'workspace-a', provider_type: 'cloudflare_container_mtproto',
    source_family: 'telegram', external_identity: 'tg-account-1', is_active: true,
    config: { chat_ids: ['-1001'] }, provider_secret_ciphertext: null,
  });
  await assert.rejects(() => resolveMtprotoContainerBootstrap({
    supabase: noSecret,
    workspaceId: 'workspace-a', sourceId: 'source-a', masterKey: 'key',
    internalSourceUrl: 'https://trade.example/internal', internalSourceToken: 'token',
    decryptFn: async () => providerSecret,
  }), /MTPROTO_PROVIDER_SECRET_NOT_CONFIGURED/);

  const malformed = supabaseWith({
    id: 'source-a', workspace_id: 'workspace-a', provider_type: 'cloudflare_container_mtproto',
    source_family: 'telegram', external_identity: 'tg-account-1', is_active: true,
    config: { chat_ids: ['-1001'] }, provider_secret_ciphertext: encrypted,
  });
  await assert.rejects(() => resolveMtprotoContainerBootstrap({
    supabase: malformed,
    workspaceId: 'workspace-a', sourceId: 'source-a', masterKey: 'key',
    internalSourceUrl: 'https://trade.example/internal', internalSourceToken: 'token',
    decryptFn: async () => JSON.stringify({ api_id: 1, api_hash: '', session_string: '' }),
  }), /MTPROTO_PROVIDER_SECRET_INVALID/);
});

test('never accepts caller bootstrap or returns ingress hmac/config secret fields as authority', async () => {
  const supabase = supabaseWith({
    id: 'source-a', workspace_id: 'workspace-a', provider_type: 'cloudflare_container_mtproto',
    source_family: 'telegram', external_identity: 'tg-account-1', is_active: true,
    config: {
      chat_ids: ['-1001'],
      api_hash: 'must-not-use',
      session_string: 'must-not-use',
      internal_source_token: 'must-not-use',
    },
    provider_secret_ciphertext: encrypted,
    secret_ciphertext: 'ingress-hmac-ciphertext',
  });

  const result = await resolveMtprotoContainerBootstrap({
    supabase,
    workspaceId: 'workspace-a', sourceId: 'source-a', masterKey: 'key',
    internalSourceUrl: 'https://trusted.example/internal', internalSourceToken: 'trusted-token',
    decryptFn: async () => providerSecret,
    bootstrap: { apiHash: 'attacker-value', sessionString: 'attacker-value' },
  });

  assert.equal(result.bootstrap.apiHash, 'telegram-api-hash');
  assert.equal(result.bootstrap.sessionString, 'telegram-session');
  assert.equal(result.bootstrap.internalSourceToken, 'trusted-token');
  assert.equal('secret_ciphertext' in result, false);
  assert.equal('provider_secret_ciphertext' in result, false);
});
