import test from 'node:test';
import assert from 'node:assert/strict';

import { runV1DestinationDeliveryStage } from '../src/destinations/v1_destination_delivery_stage.js';

const event = {
  workspace_hint: 'ws-1',
  text: 'BUY XAUUSD NOW\nsource footer',
};
const interpretation = {
  status: 'READY',
  intent: {
    side: 'BUY',
    symbol: { canonical: 'XAUUSD' },
    orderType: 'MARKET',
    entry: { kind: 'MARKET' },
    stopLoss: 2500,
    takeProfits: [2520, 2530],
  },
};

function routedTelegram(overrides = {}) {
  return {
    id: 'dest-1',
    workspace_id: 'ws-1',
    destination_type: 'telegram',
    destination_ref: '-100123',
    credential_ciphertext: 'ciphertext-only',
    is_active: true,
    template: {
      formatting_mode: 'template',
      parse_mode: 'HTML',
      brand_name: 'Mkety Signals',
      cleanup_rules: {},
    },
    ...overrides,
  };
}

test('routes a trusted source event to its active Telegram destination without exposing credentials', async () => {
  let sent;
  const stage = await runV1DestinationDeliveryStage({
    workspaceId: 'ws-1',
    sourceId: 'src-1',
    event,
    interpretation,
    env: { TRADING_MASTER_KEY: 'master-key-placeholder', BROKER_EXECUTION_ENABLED: 'false' },
  }, {
    destinationStore: {
      listRoutedDestinations: async (workspaceId, sourceId) => {
        assert.equal(workspaceId, 'ws-1');
        assert.equal(sourceId, 'src-1');
        return [routedTelegram()];
      },
      recordDestinationOutcome: async () => {},
    },
    decryptCredentials: async (ciphertext, masterKey) => {
      assert.equal(ciphertext, 'ciphertext-only');
      assert.equal(masterKey, 'master-key-placeholder');
      return JSON.stringify({ version: 1, kind: 'destination', data: { botToken: 'synthetic-bot-token' } });
    },
    sendTelegram: async (input) => {
      sent = input;
      return { ok: true, messageId: 77, status: 200 };
    },
  });

  assert.equal(stage.status, 'DELIVERED');
  assert.equal(stage.succeeded, 1);
  assert.equal(stage.failed, 0);
  assert.equal(sent.chatId, '-100123');
  assert.equal(sent.botToken, 'synthetic-bot-token');
  assert.match(sent.text, /Mkety Signals/);
  assert.match(sent.text, /XAUUSD/);
  assert.equal(sent.parseMode, 'HTML');
  assert.equal(JSON.stringify(stage).includes('synthetic-bot-token'), false);
  assert.equal(JSON.stringify(stage).includes('ciphertext-only'), false);
});

test('does not dispatch destinations outside the trusted workspace and never invokes broker execution', async () => {
  let telegramCalls = 0;
  const stage = await runV1DestinationDeliveryStage({
    workspaceId: 'ws-1',
    sourceId: 'src-1',
    event,
    interpretation,
    env: { TRADING_MASTER_KEY: 'master-key-placeholder', BROKER_EXECUTION_ENABLED: 'false' },
  }, {
    destinationStore: {
      listRoutedDestinations: async () => [
        routedTelegram({ id: 'cross-tenant', workspace_id: 'ws-2' }),
        {
          id: 'broker-1', workspace_id: 'ws-1', destination_type: 'broker_account',
          destination_ref: 'acct-1', is_active: true,
        },
      ],
      recordDestinationOutcome: async () => {},
    },
    decryptCredentials: async () => { throw new Error('must not decrypt rejected destination'); },
    sendTelegram: async () => { telegramCalls += 1; return { ok: true }; },
  });

  assert.equal(telegramCalls, 0);
  assert.equal(stage.succeeded, 0);
  assert.equal(stage.failed, 0);
  assert.equal(stage.rejected, 1);
  assert.equal(stage.blocked, 1);
  assert.deepEqual(stage.outcomes.map((item) => [item.destinationId, item.status]), [
    ['cross-tenant', 'REJECTED'],
    ['broker-1', 'BLOCKED'],
  ]);
});

test('one destination failure is isolated and cannot stop a sibling destination', async () => {
  const stage = await runV1DestinationDeliveryStage({
    workspaceId: 'ws-1', sourceId: 'src-1', event, interpretation,
    env: { TRADING_MASTER_KEY: 'master-key-placeholder', BROKER_EXECUTION_ENABLED: 'false' },
  }, {
    destinationStore: {
      listRoutedDestinations: async () => [
        routedTelegram({ id: 'bad', destination_ref: '-1001' }),
        routedTelegram({ id: 'good', destination_ref: '-1002' }),
      ],
      recordDestinationOutcome: async () => {},
    },
    decryptCredentials: async () => JSON.stringify({ version: 1, kind: 'destination', data: { botToken: 'synthetic-bot-token' } }),
    sendTelegram: async ({ chatId }) => chatId === '-1001'
      ? { ok: false, status: 503, errorCode: 'TELEGRAM_TRANSPORT_FAILED' }
      : { ok: true, status: 200, messageId: 88 },
  });

  assert.equal(stage.status, 'PARTIAL_FAILURE');
  assert.equal(stage.succeeded, 1);
  assert.equal(stage.failed, 1);
  assert.deepEqual(stage.outcomes.map((item) => [item.destinationId, item.status]), [
    ['bad', 'FAILED'],
    ['good', 'SUCCEEDED'],
  ]);
});