import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceAIRouter } from '../src/ai/workspace_ai.js';

test('loads only active AI providers for the authenticated workspace and decrypts encrypted credential lazily', async () => {
  const filters = [];
  const providers = [{
    provider_name: 'openai', model_name: 'gpt-test', priority_rank: 2,
    api_key_ciphertext: 'v1.cipher', is_active: true,
  }];
  const supabase = {
    from(table) {
      assert.equal(table, 'ai_providers');
      const chain = {
        select() { return chain; },
        eq(field, value) { filters.push([field, value]); return chain; },
        then(resolve) { resolve({ data: providers, error: null }); },
      };
      return chain;
    },
  };
  let decrypted;
  const router = await createWorkspaceAIRouter(supabase, 'ws-1', {
    masterKey: 'master',
    decryptFn: async (cipher, key) => { decrypted = [cipher, key]; return 'plain-key'; },
    fetchFn: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }),
  });

  assert.deepEqual(filters, [['workspace_id', 'ws-1'], ['is_active', true]]);
  assert.equal(router.providers.length, 1);
  assert.equal(await router.resolveCredential(router.providers[0]), 'plain-key');
  assert.deepEqual(decrypted, ['v1.cipher', 'master']);
});

test('keeps current api_key as transitional fallback without ever returning credentials in configuration output', async () => {
  const supabase = {
    from() {
      const chain = { select() { return chain; }, eq() { return chain; }, then(resolve) { resolve({ data: [{ provider_name: 'groq', model_name: 'm', api_key: 'legacy-key', is_active: true }], error: null }); } };
      return chain;
    },
  };
  const router = await createWorkspaceAIRouter(supabase, 'ws-1', { masterKey: 'master' });
  assert.equal(await router.resolveCredential(router.providers[0]), 'legacy-key');
});

test('returns an empty router when provider query fails so deterministic processing can continue', async () => {
  const supabase = {
    from() {
      const chain = { select() { return chain; }, eq() { return chain; }, then(resolve) { resolve({ data: null, error: { message: 'db down' } }); } };
      return chain;
    },
  };
  const router = await createWorkspaceAIRouter(supabase, 'ws-1', { masterKey: 'master' });
  assert.deepEqual(router.providers, []);
});
