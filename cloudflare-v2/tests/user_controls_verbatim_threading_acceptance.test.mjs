import test from 'node:test';
import assert from 'node:assert/strict';

import { renderEnterpriseTradingPortal } from '../src/dashboard_enterprise_portal.js';
import { sendTelegramDestination } from '../src/destinations/telegram_destination.js';
import { runV1DestinationDeliveryStage } from '../src/destinations/v1_destination_delivery_stage.js';

test('enterprise portal exposes existing account lot and TP-protection settings for existing accounts', () => {
  const html = renderEnterpriseTradingPortal({ TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'true' });
  assert.match(html, /data-account-fixed-lot/);
  assert.match(html, /data-account-auto-tp-protection/);
  assert.match(html, /\/api\/v1\/admin\/accounts\/.*\/fixed-lot/);
  assert.match(html, /\/api\/v1\/admin\/accounts\/.*\/auto-tp-protection/);
  assert.match(html, /lotValue/);
  assert.match(html, /autoTpProtection/);
});

test('portal makes exact forwarding visible and unambiguous', () => {
  const html = renderEnterpriseTradingPortal({ TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'true' });
  assert.match(html, /Forward as-is \(original\)/i);
  assert.match(html, /No AI, no cleanup, no reformatting/i);
});

test('Telegram destination with no template forwards source text and entities exactly', async () => {
  const sourceText = '  BUY GOLD\n\nxauusd buy  \nentry 4273.25-4279.76\nsl 4260.31\ntp 4290.25 ✅  ';
  const entities = [{ type: 'bold', offset: 2, length: 3 }];
  let sent;
  const stage = await runV1DestinationDeliveryStage({
    workspaceId: 'ws-1',
    sourceId: 'src-1',
    event: { external_event_id: 'telegram:-1001:10', text: sourceText, metadata: { telegram_entities: entities }, thread: {} },
    interpretation: { status: 'READY', intent: { side: 'BUY', symbol: { canonical: 'XAUUSD' }, orderType: 'MARKET', entry: { kind: 'MARKET' } } },
    env: { TRADING_MASTER_KEY: 'master' },
  }, {
    destinationStore: {
      listRoutedDestinations: async () => [{
        id: 'dest-1', workspace_id: 'ws-1', destination_type: 'telegram', destination_ref: '-1009',
        credential_ciphertext: 'cipher', is_active: true, template: null,
      }],
      recordDestinationOutcome: async () => {},
      resolveTelegramReplyMessageId: async () => null,
      recordTelegramMessageMapping: async () => {},
    },
    decryptCredentials: async () => JSON.stringify({ version: 1, kind: 'destination', data: { botToken: 'token' } }),
    sendTelegram: async (input) => { sent = input; return { ok: true, messageId: 501, status: 200 }; },
  });

  assert.equal(stage.status, 'DELIVERED');
  assert.equal(sent.text, sourceText);
  assert.deepEqual(sent.entities, entities);
  assert.equal(sent.parseMode, 'plain');
});

test('Telegram sender emits native reply_parameters when destination parent message is known', async () => {
  let body;
  const result = await sendTelegramDestination({
    botToken: 'token', chatId: '-1009', text: 'TP1 HIT ✅', replyToMessageId: 401,
    fetchFn: async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 402 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(body.reply_parameters, { message_id: 401, allow_sending_without_reply: false });
});

test('destination stage preserves Telegram replies using durable source-event to destination-message mapping', async () => {
  let sent;
  let recorded;
  const stage = await runV1DestinationDeliveryStage({
    workspaceId: 'ws-1',
    sourceId: 'src-1',
    event: {
      external_event_id: 'telegram:-1001:11', text: 'TP1 HIT ✅', metadata: {},
      thread: { reply_to_event_id: 'telegram:-1001:10' },
    },
    interpretation: { status: 'MANAGEMENT', management: { type: 'TARGET_HIT', targetIndex: 1 } },
    env: { TRADING_MASTER_KEY: 'master' },
  }, {
    destinationStore: {
      listRoutedDestinations: async () => [{
        id: 'dest-1', workspace_id: 'ws-1', destination_type: 'telegram', destination_ref: '-1009',
        credential_ciphertext: 'cipher', is_active: true, template: null,
      }],
      recordDestinationOutcome: async () => {},
      resolveTelegramReplyMessageId: async (_ws, destination, parentExternalEventId) => {
        assert.equal(destination.id, 'dest-1');
        assert.equal(parentExternalEventId, 'telegram:-1001:10');
        return 401;
      },
      recordTelegramMessageMapping: async (_ws, destination, externalEventId, messageId) => {
        recorded = { destinationId: destination.id, externalEventId, messageId };
      },
    },
    decryptCredentials: async () => JSON.stringify({ version: 1, kind: 'destination', data: { botToken: 'token' } }),
    sendTelegram: async (input) => { sent = input; return { ok: true, messageId: 402, status: 200 }; },
  });

  assert.equal(stage.status, 'DELIVERED');
  assert.equal(sent.replyToMessageId, 401);
  assert.equal(sent.text, 'TP1 HIT ✅');
  assert.deepEqual(recorded, { destinationId: 'dest-1', externalEventId: 'telegram:-1001:11', messageId: 402 });
});