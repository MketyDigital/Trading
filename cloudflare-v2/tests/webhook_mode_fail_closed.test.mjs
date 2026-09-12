import test from 'node:test';
import assert from 'node:assert/strict';

import { runV1DestinationDeliveryStage } from '../src/destinations/v1_destination_delivery_stage.js';

test('internal webhook rejects an unknown webhookMode without decrypting credentials or calling the network', async () => {
  let decryptCalls = 0;
  let fetchCalls = 0;
  const destination = {
    id: 'webhook-invalid-mode',
    workspace_id: 'ws-1',
    destination_type: 'internal_webhook',
    destination_ref: 'https://hooks.example.invalid/signal',
    credential_ciphertext: 'unused-encrypted-value',
    is_active: true,
    settings: { webhookMode: 'something_else' },
  };

  const stage = await runV1DestinationDeliveryStage({
    workspaceId: 'ws-1',
    sourceId: 'src-1',
    event: { external_event_id: 'evt-1', text: 'BUY EURUSD NOW' },
    interpretation: { status: 'READY', intent: { side: 'BUY', symbol: { canonical: 'EURUSD' }, orderType: 'MARKET' } },
    env: { TRADING_MASTER_KEY: 'master-key-placeholder' },
  }, {
    destinationStore: {
      listRoutedDestinations: async () => [destination],
      recordDestinationOutcome: async () => {},
    },
    decryptCredentials: async () => { decryptCalls += 1; return '{}'; },
    fetchFn: async () => { fetchCalls += 1; return new Response('', { status: 200 }); },
  });

  assert.equal(stage.status, 'FAILED');
  assert.equal(stage.failed, 1);
  assert.equal(stage.outcomes[0].errorCode, 'WEBHOOK_MODE_INVALID');
  assert.equal(decryptCalls, 0);
  assert.equal(fetchCalls, 0);
});
