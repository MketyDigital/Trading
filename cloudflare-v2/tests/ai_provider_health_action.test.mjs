import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { handleAuthorizedV1AdminAIRequest } from '../src/http/v1_admin_ai.js';

const authorization = {
  workspace: { id: 'ws-1' },
  membership: { role: 'owner' },
};

test('POST provider test persists and returns only sanitized health diagnostic', async () => {
  const secret = 'sk-never-return-this';
  const provider = {
    id: 'provider-1',
    workspace_id: 'ws-1',
    provider_name: 'openai',
    model_name: 'gpt-5.6-luna',
    api_key_ciphertext: 'ciphertext',
    api_key: secret,
    is_active: true,
  };
  let recorded = null;
  const response = await handleAuthorizedV1AdminAIRequest(
    new Request('https://trade.mkety.com/api/v1/admin/ai-providers/provider-1/test', { method: 'POST' }),
    authorization,
    {
      aiStore: {
        get: async (workspaceId, id) => {
          assert.equal(workspaceId, 'ws-1');
          assert.equal(id, 'provider-1');
          return provider;
        },
        recordHealth: async (workspaceId, id, health) => {
          recorded = { workspaceId, id, health: structuredClone(health) };
          return true;
        },
      },
      providerTester: async ({ workspaceId, provider: loaded }) => {
        assert.equal(workspaceId, 'ws-1');
        assert.equal(loaded.id, 'provider-1');
        return {
          ok: false,
          checkedAt: '2026-09-16T22:55:00.000Z',
          diagnostic: {
            providerId: 'provider-1',
            providerType: 'openai',
            model: 'gpt-5.6-luna',
            outcome: 'FAILED',
            latencyMs: 42,
            httpStatus: 401,
            providerCode: 'invalid_api_key',
            retryable: false,
            errorClass: 'AUTH',
            sanitizedMessage: 'Invalid API key.',
          },
        };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(recorded, {
    workspaceId: 'ws-1',
    id: 'provider-1',
    health: {
      status: 'FAILED',
      checked_at: '2026-09-16T22:55:00.000Z',
      diagnostic: {
        providerId: 'provider-1',
        providerType: 'openai',
        model: 'gpt-5.6-luna',
        outcome: 'FAILED',
        latencyMs: 42,
        httpStatus: 401,
        providerCode: 'invalid_api_key',
        retryable: false,
        errorClass: 'AUTH',
        sanitizedMessage: 'Invalid API key.',
      },
    },
  });

  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.workspaceId, 'ws-1');
  assert.equal(payload.providerId, 'provider-1');
  assert.equal(payload.health.status, 'FAILED');
  assert.equal(payload.health.diagnostic.providerCode, 'invalid_api_key');
  assert.equal(JSON.stringify(payload).includes(secret), false);
  assert.equal(JSON.stringify(payload).includes('ciphertext'), false);
});

test('provider test is workspace scoped and does not invoke tester when provider is missing', async () => {
  let testerCalls = 0;
  const response = await handleAuthorizedV1AdminAIRequest(
    new Request('https://trade.mkety.com/api/v1/admin/ai-providers/provider-other/test', { method: 'POST' }),
    authorization,
    {
      aiStore: {
        get: async () => null,
        recordHealth: async () => { throw new Error('must not persist'); },
      },
      providerTester: async () => { testerCalls += 1; return { ok: true }; },
    },
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { ok: false, reason: 'AI_PROVIDER_NOT_FOUND' });
  assert.equal(testerCalls, 0);
});

test('migration 0041 adds durable sanitized provider health columns', async () => {
  const sql = await readFile(new URL('../db/migrations/0041_ai_provider_health.sql', import.meta.url), 'utf8');
  assert.match(sql, /last_health_status/i);
  assert.match(sql, /last_health_checked_at/i);
  assert.match(sql, /last_health_diagnostic\s+JSONB/i);
});
