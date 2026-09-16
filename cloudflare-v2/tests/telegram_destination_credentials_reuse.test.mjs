import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handleAuthorizedV1AdminDestinationConnectionsRequest,
} from '../src/http/v1_admin_destination_connections.js';
import { runV1DestinationDeliveryStage } from '../src/destinations/v1_destination_delivery_stage.js';

function auth() {
  return { workspace: { id: 'ws-1' }, membership: { role: 'owner' } };
}

test('destination connection API encrypts one Telegram bot token without returning it', async () => {
  let encryptedPlaintext = null;
  const connectionStore = {
    async createConnection(workspaceId, input, cipher) {
      assert.equal(workspaceId, 'ws-1');
      assert.equal(input.providerType, 'telegram_bot_api');
      assert.equal(input.displayName, 'Starpips delivery bot');
      return {
        id: 'conn-1', workspace_id: workspaceId, provider_type: input.providerType,
        display_name: input.displayName, credential_ciphertext: cipher, is_active: true,
      };
    },
  };
  const response = await handleAuthorizedV1AdminDestinationConnectionsRequest(new Request(
    'https://trade.test/api/v1/admin/destination-connections',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      providerType: 'telegram_bot_api', displayName: 'Starpips delivery bot', credentials: { botToken: '123:secret' },
    }) },
  ), auth(), {
    connectionStore,
    env: { TRADING_MASTER_KEY: 'master' },
    encryptCredentials: async (plaintext) => { encryptedPlaintext = plaintext; return 'ciphertext'; },
  });
  assert.equal(response.status, 201);
  assert.match(encryptedPlaintext, /123:secret/);
  const body = await response.json();
  assert.equal(body.destinationConnection.credentialConfigured, true);
  assert.equal(JSON.stringify(body).includes('123:secret'), false);
  assert.equal(JSON.stringify(body).includes('ciphertext'), false);
});

test('one shared encrypted bot credential delivers independently to multiple Telegram destination chats', async () => {
  const sharedEnvelope = JSON.stringify({ version: 1, kind: 'destination', data: { botToken: 'shared-token' } });
  const sent = [];
  const destinationStore = {
    async listRoutedDestinations() {
      return [
        {
          id: 'dest-a', workspace_id: 'ws-1', destination_type: 'telegram', destination_ref: '-100A',
          credential_connection_id: 'conn-1', credential_connection_provider_type: 'telegram_bot_api',
          shared_credential_ciphertext: 'shared-cipher', is_active: true, settings: {}, template: { formatting_mode: 'none' },
        },
        {
          id: 'dest-b', workspace_id: 'ws-1', destination_type: 'telegram', destination_ref: '-100B',
          credential_connection_id: 'conn-1', credential_connection_provider_type: 'telegram_bot_api',
          shared_credential_ciphertext: 'shared-cipher', is_active: true, settings: {}, template: { formatting_mode: 'none' },
        },
      ];
    },
    async recordDestinationOutcome() {},
  };
  const result = await runV1DestinationDeliveryStage({
    workspaceId: 'ws-1', sourceId: 'src-1', event: { text: 'BUY XAUUSD' }, interpretation: { status: 'READY' },
    env: { TRADING_MASTER_KEY: 'master' },
  }, {
    destinationStore,
    decryptCredentials: async (ciphertext) => {
      assert.equal(ciphertext, 'shared-cipher');
      return sharedEnvelope;
    },
    formatTelegram: ({ rawText }) => ({ ok: true, text: rawText, parseMode: 'plain' }),
    sendTelegram: async ({ botToken, chatId, text }) => {
      sent.push({ botToken, chatId, text });
      return { ok: true, status: 200, messageId: sent.length };
    },
  });
  assert.equal(result.status, 'DELIVERED');
  assert.equal(result.succeeded, 2);
  assert.deepEqual(sent, [
    { botToken: 'shared-token', chatId: '-100A', text: 'BUY XAUUSD' },
    { botToken: 'shared-token', chatId: '-100B', text: 'BUY XAUUSD' },
  ]);
});

test('legacy destination-local Telegram credential remains supported', async () => {
  const destinationStore = {
    async listRoutedDestinations() {
      return [{
        id: 'legacy', workspace_id: 'ws-1', destination_type: 'telegram', destination_ref: '-100OLD',
        credential_ciphertext: 'legacy-cipher', is_active: true, settings: {}, template: { formatting_mode: 'none' },
      }];
    },
    async recordDestinationOutcome() {},
  };
  let token = null;
  const result = await runV1DestinationDeliveryStage({
    workspaceId: 'ws-1', sourceId: 'src-1', event: { text: 'old works' }, interpretation: {},
    env: { TRADING_MASTER_KEY: 'master' },
  }, {
    destinationStore,
    decryptCredentials: async () => JSON.stringify({ version: 1, kind: 'destination', data: { botToken: 'legacy-token' } }),
    formatTelegram: ({ rawText }) => ({ ok: true, text: rawText, parseMode: 'plain' }),
    sendTelegram: async (input) => { token = input.botToken; return { ok: true, status: 200 }; },
  });
  assert.equal(result.status, 'DELIVERED');
  assert.equal(token, 'legacy-token');
});
