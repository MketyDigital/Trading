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
        cleanup_rules: input.cleanupRules || {},
        layout: input.layout || {},
        is_default: Boolean(input.isDefault),
      };
      templates.push(row);
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
  };
}

test('creates Telegram destination without returning credential ciphertext', async () => {
  const store = memoryStore();
  const response = await handleAuthorizedV1AdminDestinationsRequest(
    jsonRequest('/api/v1/admin/destinations', 'POST', {
      destinationType: 'telegram',
      displayName: 'VIP Channel',
      destinationRef: '-1001234567890',
      credentials: { botToken: '123:secret' },
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
