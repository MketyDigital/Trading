import test from 'node:test';
import assert from 'node:assert/strict';

import { UniversalAIRouter } from '../src/ai/universal_ai.js';

function okJson(body) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

test('Cloudflare AI requires account ID from provider database config and never falls back to env', async () => {
  let calls = 0;
  const router = new UniversalAIRouter([
    { provider_name: 'cloudflare_ai', api_key: 'token', model_name: '@cf/test/model', is_active: true },
  ], {
    env: { CLOUDFLARE_ACCOUNT_ID: 'must-not-be-used' },
    fetchFn: async () => { calls += 1; return okJson({ result: { response: 'bad' } }); },
  });

  const result = await router.processSignal('x', 'y', { timeoutMs: 100 });
  assert.equal(result.success, false);
  assert.equal(calls, 0);
});

test('Gemini uses generateContent with x-goog-api-key header rather than credential query string', async () => {
  let url;
  let options;
  const router = new UniversalAIRouter([
    { provider_name: 'gemini', api_key: 'gem-key', model_name: 'gemini-3.8-flash', is_active: true },
  ], {
    fetchFn: async (requestedUrl, requestedOptions) => {
      url = String(requestedUrl);
      options = requestedOptions;
      return okJson({ candidates: [{ content: { parts: [{ text: 'READY' }] } }] });
    },
  });

  const result = await router.processSignal('BUY GOLD', 'interpret safely', { timeoutMs: 100 });
  assert.equal(result.success, true);
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
  assert.equal(options.headers['x-goog-api-key'], 'gem-key');
  assert.equal(url.includes('gem-key'), false);
});

test('Azure OpenAI is first-class and uses Azure v1 Responses API with api-key auth', async () => {
  let url;
  let options;
  const router = new UniversalAIRouter([
    {
      provider_name: 'azure_openai',
      api_key: 'azure-key',
      model_name: 'trading-deployment',
      base_url: 'https://mkety.openai.azure.com/openai/v1',
      is_active: true,
    },
  ], {
    fetchFn: async (requestedUrl, requestedOptions) => {
      url = String(requestedUrl);
      options = requestedOptions;
      return okJson({ output_text: 'READY' });
    },
  });

  const result = await router.processSignal('BUY GOLD', 'interpret safely', { timeoutMs: 100 });
  const payload = JSON.parse(options.body);
  assert.equal(result.success, true);
  assert.equal(url, 'https://mkety.openai.azure.com/openai/v1/responses');
  assert.equal(options.headers['api-key'], 'azure-key');
  assert.equal(options.headers.Authorization, undefined);
  assert.equal(payload.model, 'trading-deployment');
  assert.equal(payload.instructions, 'interpret safely');
  assert.equal(payload.input, 'BUY GOLD');
});

test('Vertex AI is first-class using DB project/location config and OAuth bearer credential', async () => {
  let url;
  let options;
  const router = new UniversalAIRouter([
    {
      provider_name: 'vertex_ai',
      api_key: 'oauth-access-token',
      model_name: 'gemini-3.8-flash',
      provider_config: { project_id: 'mkety-prod', location: 'us-central1' },
      is_active: true,
    },
  ], {
    fetchFn: async (requestedUrl, requestedOptions) => {
      url = String(requestedUrl);
      options = requestedOptions;
      return okJson({ candidates: [{ content: { parts: [{ text: 'READY' }] } }] });
    },
  });

  const result = await router.processSignal('BUY GOLD', 'interpret safely', { timeoutMs: 100 });
  assert.equal(result.success, true);
  assert.equal(url, 'https://us-central1-aiplatform.googleapis.com/v1/projects/mkety-prod/locations/us-central1/publishers/google/models/gemini-3.8-flash:generateContent');
  assert.equal(options.headers.Authorization, 'Bearer oauth-access-token');
});

test('AWS Bedrock is first-class and signs a regional Converse request with encrypted credential material', async () => {
  let url;
  let options;
  const credential = JSON.stringify({
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'secret-example',
    sessionToken: 'session-example',
  });
  const router = new UniversalAIRouter([
    {
      provider_name: 'aws_bedrock',
      model_name: 'anthropic.claude-test-v1',
      provider_config: { region: 'us-east-1' },
      is_active: true,
    },
  ], {
    credentialResolver: async () => credential,
    nowFn: () => new Date('2026-09-16T22:00:00.000Z'),
    fetchFn: async (requestedUrl, requestedOptions) => {
      url = String(requestedUrl);
      options = requestedOptions;
      return okJson({ output: { message: { content: [{ text: 'READY' }] } } });
    },
  });

  const result = await router.processSignal('BUY GOLD', 'interpret safely', { timeoutMs: 100 });
  assert.equal(result.success, true);
  assert.equal(url, 'https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-test-v1/converse');
  assert.match(options.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
  assert.equal(options.headers['x-amz-date'], '20260916T220000Z');
  assert.equal(options.headers['x-amz-security-token'], 'session-example');
  const payload = JSON.parse(options.body);
  assert.equal(payload.messages[0].role, 'user');
  assert.match(payload.messages[0].content[0].text, /BUY GOLD/);
});
