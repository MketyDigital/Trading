import assert from 'node:assert/strict';
import test from 'node:test';
import { handleAuthorizedV1AdminDestinationsRequest } from '../src/http/v1_admin_destinations.js';

function auth() {
  return { workspace: { id: 'ws-1' }, membership: { role: 'owner', enabled: true } };
}

function put(body) {
  return new Request('https://trade.mkety.com/api/v1/admin/destinations/dest-1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('destination update that omits credentialConnectionId preserves the existing reusable Telegram bot authority', async () => {
  let received;
  const response = await handleAuthorizedV1AdminDestinationsRequest(put({
    displayName: 'Renamed channel',
    destinationRef: '-100123',
    templateId: 'tpl-2',
    settings: { parseMode: 'HTML' },
  }), auth(), {
    destinationStore: {
      async updateDestination(_workspaceId, _id, input) {
        received = input;
        return {
          id: 'dest-1', workspace_id: 'ws-1', destination_type: 'telegram',
          display_name: input.displayName, destination_ref: input.destinationRef,
          template_id: input.templateId, credential_connection_id: 'shared-bot-1',
          settings: input.settings, is_active: true,
        };
      },
    },
  });

  assert.equal(response.status, 200);
  assert.equal(Object.prototype.hasOwnProperty.call(received, 'credentialConnectionId'), false,
    'omission must mean preserve, not clear');
  const body = await response.json();
  assert.equal(body.destination.credentialConnectionId, 'shared-bot-1');
});

test('destination update can explicitly clear a reusable credential connection with null', async () => {
  let received;
  const response = await handleAuthorizedV1AdminDestinationsRequest(put({
    displayName: 'Local-token channel',
    destinationRef: '-100123',
    settings: {},
    credentialConnectionId: null,
  }), auth(), {
    destinationStore: {
      async updateDestination(_workspaceId, _id, input) {
        received = input;
        return {
          id: 'dest-1', workspace_id: 'ws-1', destination_type: 'telegram',
          display_name: input.displayName, destination_ref: input.destinationRef,
          credential_connection_id: input.credentialConnectionId, settings: {}, is_active: false,
        };
      },
    },
  });

  assert.equal(response.status, 200);
  assert.equal(Object.prototype.hasOwnProperty.call(received, 'credentialConnectionId'), true);
  assert.equal(received.credentialConnectionId, null);
});
