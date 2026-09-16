import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { handleAuthorizedV1AdminAIRequest } from '../src/http/v1_admin_ai.js';

const authorization = {
  workspace: { id: 'ws-1' },
  membership: { role: 'owner' },
};

function request(body) {
  return new Request('https://trade.mkety.com/api/v1/admin/ai-providers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function storeCapture() {
  let created = null;
  return {
    get created() { return created; },
    store: {
      create: async (workspaceId, row) => {
        created = { workspaceId, row: structuredClone(row) };
        return { id: 'provider-1', workspace_id: workspaceId, ...row };
      },
    },
  };
}

test('Vertex AI admin create persists only safe DB config and encrypted credential material', async () => {
  const capture = storeCapture();
  const response = await handleAuthorizedV1AdminAIRequest(request({
    providerName: 'vertex_ai',
    modelName: 'gemini-3.8-flash',
    apiKey: 'oauth-access-token',
    providerConfig: {
      projectId: 'mkety-prod',
      location: 'us-central1',
      secretAccessKey: 'must-not-persist-here',
    },
  }), authorization, {
    aiStore: capture.store,
    env: { TRADING_MASTER_KEY: 'master' },
    encryptFn: async (value) => `cipher:${value}`,
  });

  assert.equal(response.status, 201);
  assert.equal(capture.created.workspaceId, 'ws-1');
  assert.equal(capture.created.row.api_key_ciphertext, 'cipher:oauth-access-token');
  assert.equal('api_key' in capture.created.row, false);
  assert.deepEqual(capture.created.row.provider_config, {
    project_id: 'mkety-prod',
    location: 'us-central1',
  });
  assert.equal('secretAccessKey' in capture.created.row.provider_config, false);

  const payload = await response.json();
  assert.equal(payload.provider.providerName, 'vertex_ai');
  assert.deepEqual(payload.provider.providerConfig, {
    project_id: 'mkety-prod',
    location: 'us-central1',
  });
  assert.equal(payload.provider.credentialConfigured, true);
  assert.equal(JSON.stringify(payload).includes('oauth-access-token'), false);
});

test('Azure OpenAI and AWS Bedrock are accepted as first-class admin provider types', async () => {
  for (const input of [
    {
      providerName: 'azure_openai',
      modelName: 'trading-deployment',
      baseUrl: 'https://mkety.openai.azure.com/openai/v1',
      apiKey: 'azure-key',
    },
    {
      providerName: 'aws_bedrock',
      modelName: 'anthropic.claude-test-v1',
      apiKey: JSON.stringify({ accessKeyId: 'AKID', secretAccessKey: 'secret' }),
      providerConfig: { region: 'us-east-1', projectId: 'must-not-persist' },
    },
  ]) {
    const capture = storeCapture();
    const response = await handleAuthorizedV1AdminAIRequest(request(input), authorization, {
      aiStore: capture.store,
      env: { TRADING_MASTER_KEY: 'master' },
      encryptFn: async () => 'ciphertext',
    });
    assert.equal(response.status, 201, input.providerName);
    assert.equal(capture.created.row.provider_name, input.providerName);
    assert.equal(capture.created.row.api_key_ciphertext, 'ciphertext');
  }
});

test('migration 0040 adds provider_config and reconciles the provider-name constraint', async () => {
  const sql = await readFile(new URL('../db/migrations/0040_ai_provider_authority.sql', import.meta.url), 'utf8');
  assert.match(sql, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+provider_config\s+JSONB/i);
  assert.match(sql, /azure_openai/i);
  assert.match(sql, /vertex_ai/i);
  assert.match(sql, /aws_bedrock/i);
  assert.match(sql, /cloudflare_ai/i);
  assert.match(sql, /CHECK\s*\(\s*provider_name\s+IN/i);
});
