import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAuthorizedV1AdminDestinationsRequest } from '../src/http/v1_admin_destinations.js';
import { createV1SimulationDependencies } from '../src/pipeline/v1_simulation_deps.js';
import { runV1DestinationDeliveryStage } from '../src/destinations/v1_destination_delivery_stage.js';

function auth() {
  return { workspace: { id: 'ws-1' }, membership: { role: 'owner', enabled: true } };
}

function request(body) {
  return new Request('https://trade.mkety.com/api/v1/admin/destinations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

test('webhook destination normalizes its signing secret before encrypted storage', async () => {
  let encryptedPlaintext = null;
  const response = await handleAuthorizedV1AdminDestinationsRequest(request({
    destinationType: 'internal_webhook',
    displayName: 'Outbound API',
    destinationRef: 'https://example.com/hook',
    credentials: { secret: 'legacy-ui-secret' },
  }), auth(), {
    env: { TRADING_MASTER_KEY: 'master' },
    encryptCredentials: async (plaintext) => { encryptedPlaintext = plaintext; return 'cipher'; },
    destinationStore: {
      createDestination: async (workspaceId, input, credentialCiphertext) => ({
        id: 'dest-1', workspace_id: workspaceId, destination_type: input.destinationType,
        display_name: input.displayName, destination_ref: input.destinationRef,
        credential_ciphertext: credentialCiphertext, is_active: false,
      }),
    },
  });
  assert.equal(response.status, 201);
  const envelope = JSON.parse(encryptedPlaintext);
  assert.equal(envelope.data.signingSecret, 'legacy-ui-secret');
  assert.equal('secret' in envelope.data, false);
});

test('webhook destination rejects missing signing credentials', async () => {
  const response = await handleAuthorizedV1AdminDestinationsRequest(request({
    destinationType: 'internal_webhook', displayName: 'Outbound API', destinationRef: 'https://example.com/hook',
  }), auth(), { destinationStore: {} });
  assert.equal(response.status, 400);
});

function query(data) {
  return {
    select() { return this; }, eq() { return this; }, in() { return this; }, order() { return Promise.resolve({ data, error: null }); },
    then(resolve) { return Promise.resolve({ data, error: null }).then(resolve); },
  };
}

test('simulation account provider selects only broker accounts routed from the authenticated source', async () => {
  const calls = [];
  const supabase = {
    from(table) {
      calls.push(table);
      if (table === 'source_destination_routes') return query([{ destination_id: 'dest-broker', priority: 1 }]);
      if (table === 'trading_destinations') return query([{ id: 'dest-broker', destination_ref: 'acct-2', destination_type: 'broker_account' }]);
      if (table === 'trade_accounts') return query([{ id: 'acct-2', workspace_id: 'ws-1', is_active: true }]);
      throw new Error(`unexpected table ${table}`);
    },
  };
  const env = {
    TRADE_STATE_INTERNAL_TOKEN: 'token',
    TRADE_STATE_NAMESPACE: { idFromName: (x) => x, get: () => ({ fetch: async () => new Response('{}') }) },
  };
  const deps = await createV1SimulationDependencies({ env, supabase, event: { workspace_hint: 'ws-1' }, sourceId: 'src-1' });
  const accounts = await deps.accountProvider();
  assert.deepEqual(accounts.map((x) => x.id), ['acct-2']);
  assert.deepEqual(calls, ['source_destination_routes', 'trading_destinations', 'trade_accounts']);
});

test('broker destination is execution-routed when master fuse is on, not marked unwired', async () => {
  const stage = await runV1DestinationDeliveryStage({
    workspaceId: 'ws-1', sourceId: 'src-1', event: {}, interpretation: {}, env: { BROKER_EXECUTION_ENABLED: 'true' },
  }, {
    destinationStore: {
      listRoutedDestinations: async () => [{ id: 'd1', workspace_id: 'ws-1', destination_type: 'broker_account', destination_ref: 'acct-1', is_active: true }],
      recordDestinationOutcome: async () => {},
    },
  });
  assert.equal(stage.outcomes[0].status, 'ROUTED');
  assert.equal(stage.outcomes[0].errorCode, undefined);
  assert.equal(JSON.stringify(stage).includes('NOT_WIRED'), false);
});
