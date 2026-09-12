import test from 'node:test';
import assert from 'node:assert/strict';

import { runV1DestinationDeliveryStage } from '../src/destinations/v1_destination_delivery_stage.js';

const event = {
  workspace_hint: 'ws-1',
  external_event_id: 'evt-webhook-1',
  text: 'SELL EURUSD 1.1000 SL 1.1050 TP 1.0900',
  metadata: {
    native_identity: { chat_id: '-100123456', message_id: '77' },
    telegram_payload: { chat_id: '-100123456', message_id: 77, text: 'SELL EURUSD 1.1000 SL 1.1050 TP 1.0900' },
  },
};
const interpretation = {
  status: 'READY',
  intent: {
    side: 'SELL',
    symbol: { canonical: 'EURUSD' },
    orderType: 'MARKET',
    entry: { kind: 'PRICE', value: 1.1 },
    stopLoss: 1.105,
    takeProfits: [1.09],
  },
};

function webhookDestination(overrides = {}) {
  return {
    id: 'webhook-1',
    workspace_id: 'ws-1',
    destination_type: 'internal_webhook',
    destination_ref: 'https://hooks.example.invalid/signal',
    credential_ciphertext: 'encrypted-webhook-secret',
    is_active: true,
    settings: {},
    ...overrides,
  };
}

test('internal webhook signed mode remains the default and sends canonical Mkety payload', async () => {
  let request;
  const stage = await runV1DestinationDeliveryStage({
    workspaceId: 'ws-1', sourceId: 'src-1', event, interpretation,
    env: { TRADING_MASTER_KEY: 'master-key-placeholder', BROKER_EXECUTION_ENABLED: 'false' },
  }, {
    destinationStore: {
      listRoutedDestinations: async () => [webhookDestination()],
      recordDestinationOutcome: async () => {},
    },
    decryptCredentials: async () => JSON.stringify({
      version: 1,
      kind: 'destination',
      data: { signingSecret: 'synthetic-signing-secret' },
    }),
    sendWebhook: async (input) => {
      request = input;
      return { ok: true, status: 202, deliveryRef: 'accepted-1' };
    },
  });

  assert.equal(stage.status, 'DELIVERED');
  assert.equal(stage.succeeded, 1);
  assert.equal(request.url, 'https://hooks.example.invalid/signal');
  assert.equal(request.workspaceId, 'ws-1');
  assert.equal(request.sourceId, 'src-1');
  assert.equal(request.signingSecret, 'synthetic-signing-secret');
  assert.equal(request.payload.workspaceId, 'ws-1');
  assert.equal(request.payload.sourceId, 'src-1');
  assert.deepEqual(request.payload.intent, interpretation.intent);
  assert.equal(Object.hasOwn(request.payload, 'rawCredential'), false);
  assert.equal(JSON.stringify(stage).includes('synthetic-signing-secret'), false);
  assert.equal(JSON.stringify(stage).includes('encrypted-webhook-secret'), false);
});

test('internal webhook raw_text mode posts only source message text and requires no destination credentials', async () => {
  let networkRequest;
  let decryptCalls = 0;
  const stage = await runV1DestinationDeliveryStage({
    workspaceId: 'ws-1', sourceId: 'src-1', event, interpretation,
    env: { TRADING_MASTER_KEY: 'master-key-placeholder', BROKER_EXECUTION_ENABLED: 'false' },
  }, {
    destinationStore: {
      listRoutedDestinations: async () => [webhookDestination({
        credential_ciphertext: null,
        settings: { webhookMode: 'raw_text' },
      })],
      recordDestinationOutcome: async () => {},
    },
    decryptCredentials: async () => { decryptCalls += 1; throw new Error('must not decrypt'); },
    fetchFn: async (url, options) => {
      networkRequest = { url, options };
      return new Response('', { status: 202 });
    },
  });

  assert.equal(stage.status, 'DELIVERED');
  assert.equal(stage.succeeded, 1);
  assert.equal(decryptCalls, 0);
  assert.equal(networkRequest.url, 'https://hooks.example.invalid/signal');
  assert.equal(networkRequest.options.method, 'POST');
  assert.equal(networkRequest.options.body, event.text);
  assert.equal(networkRequest.options.headers['Content-Type'], 'text/plain; charset=utf-8');
  assert.equal(Object.keys(networkRequest.options.headers).some((key) => key.toLowerCase().startsWith('x-mkety-')), false);
});

test('internal webhook raw_json mode posts source event directly without Mkety wrapper or signature requirements', async () => {
  let networkRequest;
  const stage = await runV1DestinationDeliveryStage({
    workspaceId: 'ws-1', sourceId: 'src-1', event, interpretation,
    env: { TRADING_MASTER_KEY: 'master-key-placeholder', BROKER_EXECUTION_ENABLED: 'false' },
  }, {
    destinationStore: {
      listRoutedDestinations: async () => [webhookDestination({
        credential_ciphertext: null,
        settings: { webhookMode: 'raw_json' },
      })],
      recordDestinationOutcome: async () => {},
    },
    fetchFn: async (url, options) => {
      networkRequest = { url, options };
      return new Response('', { status: 200 });
    },
  });

  assert.equal(stage.status, 'DELIVERED');
  assert.equal(stage.succeeded, 1);
  assert.equal(networkRequest.options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(networkRequest.options.body), event);
  assert.equal(Object.keys(networkRequest.options.headers).some((key) => key.toLowerCase().startsWith('x-mkety-')), false);
});

test('internal webhook rejects non-https destination URLs before any network call in every mode', async () => {
  let calls = 0;
  const stage = await runV1DestinationDeliveryStage({
    workspaceId: 'ws-1', sourceId: 'src-1', event, interpretation,
    env: { TRADING_MASTER_KEY: 'master-key-placeholder', BROKER_EXECUTION_ENABLED: 'false' },
  }, {
    destinationStore: {
      listRoutedDestinations: async () => [webhookDestination({
        destination_ref: 'http://127.0.0.1/private',
        credential_ciphertext: null,
        settings: { webhookMode: 'raw_text' },
      })],
      recordDestinationOutcome: async () => {},
    },
    fetchFn: async () => { calls += 1; return new Response('', { status: 200 }); },
  });

  assert.equal(calls, 0);
  assert.equal(stage.succeeded, 0);
  assert.equal(stage.failed, 1);
  assert.equal(stage.outcomes[0].errorCode, 'WEBHOOK_HTTPS_REQUIRED');
});
