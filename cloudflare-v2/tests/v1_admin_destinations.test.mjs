import test from 'node:test';
import assert from 'node:assert/strict';

import { handleAuthorizedV1AdminDestinationsRequest } from '../src/http/v1_admin_destinations.js';

function auth(role = 'owner') {
  return {
    workspace: { id: 'ws-1' },
    membership: { role, enabled: true },
    auth: { subject: 'access-code:owner@example.com' },
  };
}

function jsonRequest(path, method = 'GET', body = undefined) {
  return new Request(`https://trade.mkety.com${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function memoryStore() {
  const destinations = [];
  const templates = [];
  const routes = [];
  return {
    _destinations: destinations,
    _templates: templates,
    _routes: routes,
    async listDestinations(workspaceId) {
      return destinations.filter((item) => item.workspace_id === workspaceId);
    },
    async createDestination(workspaceId, input, credentialCiphertext) {
      const row = {
        id: `dest-${destinations.length + 1}`,
        workspace_id: workspaceId,
        destination_type: input.destinationType,
        display_name: input.displayName,
        destination_ref: input.destinationRef,
        template_id: input.templateId ?? null,
        credential_ciphertext: credentialCiphertext ?? null,
        settings: input.settings || {},
        is_active: false,
        health_status: 'DISABLED',
      };
      destinations.push(row);
      return row;
    },
    async updateDestination(workspaceId, id, input) {
      const row = destinations.find((item) => item.workspace_id === workspaceId && item.id === id);
      if (!row) return null;
      row.display_name = input.displayName;
      row.destination_ref = input.destinationRef;
      row.template_id = input.templateId ?? null;
      row.settings = input.settings || {};
      return row;
    },
    async setDestinationEnabled(workspaceId, id, enabled) {
      const row = destinations.find((item) => item.workspace_id === workspaceId && item.id === id);
      if (!row) return null;
      row.is_active = Boolean(enabled);
      row.health_status = enabled ? 'PENDING' : 'DISABLED';
      return row;
    },
    async replaceDestinationCredentials(workspaceId, id, credentialCiphertext) {
      const row = destinations.find((item) => item.workspace_id === workspaceId && item.id === id);
      if (!row) return null;
      row.credential_ciphertext = credentialCiphertext;
      return row;
    },
    async listTemplates(workspaceId) {
      return templates.filter((item) => item.workspace_id === workspaceId);
    },
    async createTemplate(workspaceId, input) {
      const row = {
        id: `tpl-${templates.length + 1}`,
        workspace_id: workspaceId,
        template_name: input.templateName,
        formatting_mode: input.formattingMode,
        parse_mode: input.parseMode,
        brand_name: input.brandName,
        header: input.header,
        footer: input.footer,
        disclaimer: input.disclaimer,
        emoji_style: input.emojiStyle,
        cleanup_rules: input.cleanupRules || {},
        layout: input.layout || {},
        is_default: Boolean(input.isDefault),
      };
      templates.push(row);
      return row;
    },
    async updateTemplate(workspaceId, id, input) {
      const row = templates.find((item) => item.workspace_id === workspaceId && item.id === id);
      if (!row) return null;
      row.template_name = input.templateName;
      row.formatting_mode = input.formattingMode;
      row.parse_mode = input.parseMode;
      row.brand_name = input.brandName;
      row.header = input.header;
      row.footer = input.footer;
      row.disclaimer = input.disclaimer;
      row.emoji_style = input.emojiStyle;
      row.cleanup_rules = input.cleanupRules || {};
      row.layout = input.layout || {};
      row.is_default = Boolean(input.isDefault);
      return row;
    },
    async listRoutes(workspaceId) {
      return routes.filter((item) => item.workspace_id === workspaceId);
    },
    async createRoute(workspaceId, input) {
      const row = {
        id: `route-${routes.length + 1}`,
        workspace_id: workspaceId,
        source_connection_id: input.sourceConnectionId,
        destination_id: input.destinationId,
        route_name: input.routeName ?? null,
        priority: input.priority ?? 100,
        is_active: true,
        filters: input.filters || {},
      };
      routes.push(row);
      return row;
    },
    async setRouteEnabled(workspaceId, id, enabled) {
      const row = routes.find((item) => item.workspace_id === workspaceId && item.id === id);
      if (!row) return null;
      row.is_active = Boolean(enabled);
      return row;
    },
  };
}

test('creates Telegram destination without returning credential ciphertext', async () => {
  const store = memoryStore();
  const response = await handleAuthorizedV1AdminDestinationsRequest(
    jsonRequest('/api/v1/admin/destinations', 'POST', {
      destinationType: 'telegram',
      displayName: 'VIP Channel',
      destinationRef: '-1001234567890',
      credentials: { botToken: 'TEST_BOT_TOKEN' },
      settings: { parseMode: 'HTML' },
    }),
    auth(),
    {
      destinationStore: store,
      env: { TRADING_MASTER_KEY: 'test-master-key' },
      encryptCredentials: async () => 'ciphertext-secret',
    }
  );

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.destination.credentialConfigured, true);
  assert.equal(body.destination.credential_ciphertext, undefined);
  assert.equal(body.destination.credentialCiphertext, undefined);
});

test('creates formatting template with safe owner-controlled branding fields', async () => {
  const store = memoryStore();
  const response = await handleAuthorizedV1AdminDestinationsRequest(
    jsonRequest('/api/v1/admin/templates', 'POST', {
      templateName: 'Starpips VIP',
      formattingMode: 'template',
      parseMode: 'HTML',
      brandName: 'Starpips Forex',
      header: 'VIP SIGNAL',
      footer: 'Risk properly.',
      cleanupRules: { removeLinks: true },
    }),
    auth(),
    { destinationStore: store }
  );

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.template.brandName, 'Starpips Forex');
  assert.equal(body.template.formattingMode, 'template');
});

test('creates source-to-destination route inside the authorized workspace only', async () => {
  const store = memoryStore();
  const response = await handleAuthorizedV1AdminDestinationsRequest(
    jsonRequest('/api/v1/admin/routes', 'POST', {
      sourceConnectionId: 'source-1',
      destinationId: 'dest-1',
      routeName: 'Free to VIP',
      priority: 10,
    }),
    auth(),
    { destinationStore: store }
  );

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.route.workspaceId, 'ws-1');
  assert.equal(body.route.sourceConnectionId, 'source-1');
  assert.equal(body.route.destinationId, 'dest-1');
});

test('updates and enables a destination only through the authorized workspace store', async () => {
  const store = memoryStore();
  await handleAuthorizedV1AdminDestinationsRequest(jsonRequest('/api/v1/admin/destinations', 'POST', {
    destinationType: 'telegram', displayName: 'Old name', destinationRef: '-1001', settings: {},
  }), auth(), { destinationStore: store });

  const updated = await handleAuthorizedV1AdminDestinationsRequest(jsonRequest('/api/v1/admin/destinations/dest-1', 'PUT', {
    destinationType: 'telegram', displayName: 'VIP Channel', destinationRef: '-1002', templateId: 'tpl-1', settings: { parseMode: 'HTML' },
  }), auth(), { destinationStore: store });
  assert.equal(updated.status, 200);
  const updatedBody = await updated.json();
  assert.equal(updatedBody.destination.displayName, 'VIP Channel');
  assert.equal(updatedBody.destination.destinationRef, '-1002');

  const enabled = await handleAuthorizedV1AdminDestinationsRequest(jsonRequest('/api/v1/admin/destinations/dest-1/enable', 'POST'), auth(), { destinationStore: store });
  assert.equal(enabled.status, 200);
  const enabledBody = await enabled.json();
  assert.equal(enabledBody.destination.enabled, true);
});

test('replaces destination credentials without returning ciphertext or plaintext', async () => {
  const store = memoryStore();
  await handleAuthorizedV1AdminDestinationsRequest(jsonRequest('/api/v1/admin/destinations', 'POST', {
    destinationType: 'telegram', displayName: 'VIP Channel', destinationRef: '-1001', settings: {},
  }), auth(), { destinationStore: store });

  const response = await handleAuthorizedV1AdminDestinationsRequest(jsonRequest('/api/v1/admin/destinations/dest-1/credentials', 'PUT', {
    credentials: { botToken: 'TEST_REPLACEMENT_TOKEN' },
  }), auth(), {
    destinationStore: store,
    env: { TRADING_MASTER_KEY: 'test-master-key' },
    encryptCredentials: async () => 'replacement-ciphertext',
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.destination.credentialConfigured, true);
  assert.equal(JSON.stringify(body).includes('replacement-ciphertext'), false);
  assert.equal(JSON.stringify(body).includes('TEST_REPLACEMENT_TOKEN'), false);
});

test('updates formatting templates and toggles routes', async () => {
  const store = memoryStore();
  await handleAuthorizedV1AdminDestinationsRequest(jsonRequest('/api/v1/admin/templates', 'POST', {
    templateName: 'Original', formattingMode: 'template', parseMode: 'HTML', brandName: 'Old Brand',
  }), auth(), { destinationStore: store });
  await handleAuthorizedV1AdminDestinationsRequest(jsonRequest('/api/v1/admin/routes', 'POST', {
    sourceConnectionId: 'source-1', destinationId: 'dest-1', routeName: 'Route 1',
  }), auth(), { destinationStore: store });

  const templateResponse = await handleAuthorizedV1AdminDestinationsRequest(jsonRequest('/api/v1/admin/templates/tpl-1', 'PUT', {
    templateName: 'Updated', formattingMode: 'ai_then_fallback', parseMode: 'HTML', brandName: 'New Brand', header: 'SIGNAL',
  }), auth(), { destinationStore: store });
  assert.equal(templateResponse.status, 200);
  const templateBody = await templateResponse.json();
  assert.equal(templateBody.template.brandName, 'New Brand');
  assert.equal(templateBody.template.formattingMode, 'ai_then_fallback');

  const routeResponse = await handleAuthorizedV1AdminDestinationsRequest(jsonRequest('/api/v1/admin/routes/route-1/disable', 'POST'), auth(), { destinationStore: store });
  assert.equal(routeResponse.status, 200);
  const routeBody = await routeResponse.json();
  assert.equal(routeBody.route.enabled, false);
});

test('creates an updates-only Telegram notification template with a heading and an exact allowlist', async () => {
  const store = memoryStore();
  const response = await handleAuthorizedV1AdminDestinationsRequest(
    jsonRequest('/api/v1/admin/templates', 'POST', {
      templateName: 'VIP Updates Only',
      formattingMode: 'clean',
      parseMode: 'plain',
      header: 'FROM VIP',
      layout: {
        deliveryPolicy: {
          mode: 'updates_only',
          allowedEvents: ['TP_HIT', 'SL_HIT', 'WEEKLY_ROUNDUP'],
          prependHeader: true,
        },
      },
    }),
    auth(),
    { destinationStore: store },
  );

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.template.header, 'FROM VIP');
  assert.equal(body.template.formattingMode, 'clean');
  assert.deepEqual(body.template.layout.deliveryPolicy, {
    mode: 'updates_only',
    allowedEvents: ['TP_HIT', 'SL_HIT', 'WEEKLY_ROUNDUP'],
    prependHeader: true,
  });
});

test('rejects an updates-only template allowlist that includes trade signals or unknown types', async () => {
  const store = memoryStore();
  const response = await handleAuthorizedV1AdminDestinationsRequest(
    jsonRequest('/api/v1/admin/templates', 'POST', {
      templateName: 'Unsafe updates template',
      formattingMode: 'clean',
      parseMode: 'plain',
      layout: {
        deliveryPolicy: {
          mode: 'updates_only',
          allowedEvents: ['TP_HIT', 'NEW_SIGNAL'],
        },
      },
    }),
    auth(),
    { destinationStore: store },
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).reason, 'TEMPLATE_UPDATE_EVENTS_INVALID');
});

test('non-owner cannot create an updates-only destination template', async () => {
  const store = memoryStore();
  const response = await handleAuthorizedV1AdminDestinationsRequest(
    jsonRequest('/api/v1/admin/templates', 'POST', {
      templateName: 'Updates only',
      formattingMode: 'clean',
      parseMode: 'plain',
      layout: {
        deliveryPolicy: {
          mode: 'updates_only',
          allowedEvents: ['TP_HIT'],
        },
      },
    }),
    auth('viewer'),
    { destinationStore: store },
  );

  assert.equal(response.status, 403);
  assert.equal((await response.json()).reason, 'TRADING_PERMISSION_DENIED');
});

test('updates-only templates require deterministic clean plain-text formatting', async () => {
  const store = memoryStore();
  const response = await handleAuthorizedV1AdminDestinationsRequest(
    jsonRequest('/api/v1/admin/templates', 'POST', {
      templateName: 'Wrong mode',
      formattingMode: 'template',
      parseMode: 'HTML',
      layout: {
        deliveryPolicy: {
          mode: 'updates_only',
          allowedEvents: ['TP_HIT'],
        },
      },
    }),
    auth(),
    { destinationStore: store },
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).reason, 'TEMPLATE_UPDATE_FORMAT_MODE_REQUIRED');
});

test('rejects assigning an updates-only template to a non-Telegram destination on create and update', async () => {
  const store = memoryStore();
  const templateResponse = await handleAuthorizedV1AdminDestinationsRequest(
    jsonRequest('/api/v1/admin/templates', 'POST', {
      templateName: 'VIP Updates Only',
      formattingMode: 'clean',
      parseMode: 'plain',
      header: 'FROM VIP',
      layout: {
        deliveryPolicy: { mode: 'updates_only', allowedEvents: ['TP_HIT', 'SL_HIT'] },
      },
    }),
    auth(),
    { destinationStore: store },
  );
  assert.equal(templateResponse.status, 201);

  const createBroker = await handleAuthorizedV1AdminDestinationsRequest(
    jsonRequest('/api/v1/admin/destinations', 'POST', {
      destinationType: 'broker_account',
      displayName: 'MT5 execution',
      destinationRef: 'account-1',
      templateId: 'tpl-1',
      settings: {},
    }),
    auth(),
    { destinationStore: store },
  );
  assert.equal(createBroker.status, 400);
  assert.equal((await createBroker.json()).reason, 'UPDATES_ONLY_TEMPLATE_TELEGRAM_ONLY');

  const createPlainBroker = await handleAuthorizedV1AdminDestinationsRequest(
    jsonRequest('/api/v1/admin/destinations', 'POST', {
      destinationType: 'broker_account',
      displayName: 'MT5 execution',
      destinationRef: 'account-2',
      settings: {},
    }),
    auth(),
    { destinationStore: store },
  );
  assert.equal(createPlainBroker.status, 201);

  const updateBroker = await handleAuthorizedV1AdminDestinationsRequest(
    jsonRequest('/api/v1/admin/destinations/dest-1', 'PUT', {
      displayName: 'MT5 execution',
      destinationRef: 'account-2',
      templateId: 'tpl-1',
      settings: {},
    }),
    auth(),
    { destinationStore: store },
  );
  assert.equal(updateBroker.status, 400);
  assert.equal((await updateBroker.json()).reason, 'UPDATES_ONLY_TEMPLATE_TELEGRAM_ONLY');
});

test('rejects converting a template to updates-only while it remains assigned to a non-Telegram destination', async () => {
  const store = memoryStore();
  await handleAuthorizedV1AdminDestinationsRequest(
    jsonRequest('/api/v1/admin/templates', 'POST', {
      templateName: 'Standard',
      formattingMode: 'template',
      parseMode: 'HTML',
    }),
    auth(),
    { destinationStore: store },
  );
  store._destinations.push({
    id: 'legacy-broker',
    workspace_id: 'ws-1',
    destination_type: 'broker_account',
    template_id: 'tpl-1',
  });

  const response = await handleAuthorizedV1AdminDestinationsRequest(
    jsonRequest('/api/v1/admin/templates/tpl-1', 'PUT', {
      templateName: 'Standard',
      formattingMode: 'clean',
      parseMode: 'plain',
      header: 'FROM VIP',
      layout: {
        deliveryPolicy: { mode: 'updates_only', allowedEvents: ['WEEKLY_ROUNDUP'] },
      },
    }),
    auth(),
    { destinationStore: store },
  );

  assert.equal(response.status, 409);
  assert.equal((await response.json()).reason, 'UPDATES_ONLY_TEMPLATE_HAS_NON_TELEGRAM_DESTINATIONS');
});

test('rejects malformed notification delivery-policy shapes', async () => {
  const store = memoryStore();
  const response = await handleAuthorizedV1AdminDestinationsRequest(
    jsonRequest('/api/v1/admin/templates', 'POST', {
      templateName: 'Malformed updates template',
      formattingMode: 'clean',
      parseMode: 'plain',
      layout: { deliveryPolicy: 'updates_only' },
    }),
    auth(),
    { destinationStore: store },
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).reason, 'TEMPLATE_DELIVERY_POLICY_INVALID');
});
