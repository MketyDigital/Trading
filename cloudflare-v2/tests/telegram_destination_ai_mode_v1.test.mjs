import test from 'node:test';
import assert from 'node:assert/strict';

import { runV1DestinationDeliveryStage } from '../src/destinations/v1_destination_delivery_stage.js';

const interpretation = {
  status: 'READY',
  intent: {
    side: 'BUY',
    orderType: 'MARKET',
    symbol: { canonical: 'XAUUSD' },
    entry: { kind: 'MARKET' },
    stopLoss: 2490,
    takeProfits: [2510, 2520],
  },
};

function destination(mode = 'ai_then_fallback') {
  return {
    id: 'dest-1',
    workspace_id: 'ws-1',
    destination_type: 'telegram',
    destination_ref: '-1001',
    credential_ciphertext: 'cipher',
    is_active: true,
    settings: { timeoutMs: 800 },
    template: {
      formatting_mode: mode,
      parse_mode: 'HTML',
      brand_name: 'Starpips VIP',
      header: 'Premium Signal',
      footer: 'Manage risk.',
      cleanup_rules: {},
      layout: { fieldOrder: ['sideSymbol', 'entry', 'stopLoss', 'takeProfits'] },
    },
  };
}

function store(row = destination()) {
  return {
    listRoutedDestinations: async () => [row],
    recordDestinationOutcome: async () => {},
  };
}

function decrypt() {
  return JSON.stringify({ version: 1, kind: 'destination', data: { botToken: '123:abc' } });
}

async function stage({ row = destination(), aiFormatterFactory, sendTelegram } = {}) {
  return runV1DestinationDeliveryStage({
    workspaceId: 'ws-1',
    sourceId: 'src-1',
    event: { text: 'BUY GOLD NOW SL 2490 TP 2510 2520' },
    interpretation,
    env: { TRADING_MASTER_KEY: 'master' },
  }, {
    destinationStore: store(row),
    decryptCredentials: async () => decrypt(),
    aiFormatterFactory,
    sendTelegram,
  });
}

test('ai_then_fallback uses destination AI presentation when canonical echo is unchanged', async () => {
  let sentText = null;
  let factoryCalls = 0;
  const result = await stage({
    aiFormatterFactory: async () => {
      factoryCalls += 1;
      return async ({ canonical }) => ({
        success: true,
        text: '🔥 STARPIPS VIP\nBUY XAUUSD\nSL 2490\nTP1 2510\nTP2 2520',
        canonicalEcho: canonical,
      });
    },
    sendTelegram: async ({ text }) => { sentText = text; return { ok: true, status: 200, messageId: 7 }; },
  });

  assert.equal(result.status, 'DELIVERED');
  assert.equal(factoryCalls, 1);
  assert.match(sentText, /🔥 STARPIPS VIP/);
});

test('ai_then_fallback still delivers deterministic branded signal when AI fails', async () => {
  let sentText = null;
  const result = await stage({
    aiFormatterFactory: async () => async () => ({ success: false, error: 'provider down' }),
    sendTelegram: async ({ text }) => { sentText = text; return { ok: true, status: 200, messageId: 8 }; },
  });

  assert.equal(result.status, 'DELIVERED');
  assert.match(sentText, /Starpips VIP/i);
  assert.match(sentText, /BUY XAUUSD/i);
  assert.match(sentText, /2490/);
  assert.match(sentText, /2510/);
});

test('ai_then_fallback rejects semantic drift from AI and sends deterministic canonical values', async () => {
  let sentText = null;
  const result = await stage({
    aiFormatterFactory: async () => async ({ canonical }) => ({
      success: true,
      text: 'SELL XAUUSD SL 2600 TP 2400',
      canonicalEcho: { ...canonical, side: 'SELL', stopLoss: 2600, takeProfits: [2400] },
    }),
    sendTelegram: async ({ text }) => { sentText = text; return { ok: true, status: 200, messageId: 9 }; },
  });

  assert.equal(result.status, 'DELIVERED');
  assert.match(sentText, /BUY XAUUSD/i);
  assert.doesNotMatch(sentText, /SELL XAUUSD/i);
});

test('non-AI template mode never initializes destination AI', async () => {
  let factoryCalls = 0;
  const result = await stage({
    row: destination('template'),
    aiFormatterFactory: async () => { factoryCalls += 1; throw new Error('must not initialize AI'); },
    sendTelegram: async () => ({ ok: true, status: 200, messageId: 10 }),
  });

  assert.equal(result.status, 'DELIVERED');
  assert.equal(factoryCalls, 0);
});

test('ai_then_fallback can still forward cleaned raw text when canonical intent is unavailable and AI cannot help', async () => {
  let sentText = null;
  const result = await runV1DestinationDeliveryStage({
    workspaceId: 'ws-1',
    sourceId: 'src-1',
    event: { text: 'Gold looking good, protect the trade and use the usual targets' },
    interpretation: { status: 'NEEDS_REVIEW', reason: 'ambiguous' },
    env: { TRADING_MASTER_KEY: 'master' },
  }, {
    destinationStore: store(destination()),
    decryptCredentials: async () => decrypt(),
    aiFormatterFactory: async () => async () => ({ success: false }),
    sendTelegram: async ({ text }) => { sentText = text; return { ok: true, status: 200, messageId: 11 }; },
  });

  assert.equal(result.status, 'DELIVERED');
  assert.match(sentText, /Gold looking good/);
});