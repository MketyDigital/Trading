import test from 'node:test';
import assert from 'node:assert/strict';

import { handleAuthorizedV1AdminSourcesRequest } from '../src/http/v1_admin_sources.js';
import { handleAuthorizedV1AdminDestinationsRequest } from '../src/http/v1_admin_destinations.js';
import { handleAuthorizedV1AdminDestinationConnectionsRequest } from '../src/http/v1_admin_destination_connections.js';

function auth() {
  return { workspace: { id: 'ws-1' }, membership: { role: 'owner', enabled: true } };
}

function request(path, method = 'GET', body = undefined) {
  return new Request(`https://trade.mkety.com${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('source configuration is edited in place and reconciles Telegram child feeds', async () => {
  const calls = [];
  const sourceStore = {
    async getSource() {
      return {
        id: 'source-1', workspaceId: 'ws-1', providerType: 'external_mtproto', sourceFamily: 'telegram',
        sourceType: 'telegram_mtproto', sourceInstanceId: 'main-userbot', displayName: 'Old source',
        externalIdentity: 'telegram-account-1', priority: 10, config: { chat_acceptance_mode: 'allowlist', allowed_chat_ids: ['-1001'] },
        enabled: true, health: { status: 'HEALTHY', restartCount: 0 },
      };
    },
    async updateSource(workspaceId, id, input) {
      calls.push(['update', workspaceId, id, input]);
      return {
        id, workspaceId, providerType: 'external_mtproto', sourceFamily: 'telegram', sourceType: 'telegram_mtproto',
        sourceInstanceId: 'main-userbot', displayName: input.displayName, externalIdentity: input.externalIdentity,
        priority: input.priority, config: input.config, enabled: true, health: { status: 'HEALTHY', restartCount: 0 },
      };
    },
    async syncSourceFeeds(workspaceId, id, providerType, config) {
      calls.push(['sync', workspaceId, id, providerType, config]);
      return [];
    },
  };

  const response = await handleAuthorizedV1AdminSourcesRequest(
    request('/api/v1/admin/sources/source-1', 'PUT', {
      displayName: 'Main userbot',
      priority: 3,
      externalIdentity: 'telegram-account-1',
      config: { chat_acceptance_mode: 'allowlist', allowed_chat_ids: ['-1001', '-1002'] },
    }),
    auth(),
    { sourceStore },
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.source.id, 'source-1');
  assert.equal(body.source.displayName, 'Main userbot');
  assert.equal(calls[0][0], 'update');
  assert.equal(calls[1][0], 'sync');
  assert.deepEqual(calls[1][4].allowed_chat_ids, ['-1001', '-1002']);
});

test('source feed label/state is editable without recreating the parent source', async () => {
  let updateCall = null;
  const sourceStore = {
    async getSource() { return { id: 'source-1', workspaceId: 'ws-1', providerType: 'external_mtproto' }; },
    async updateSourceFeed(workspaceId, sourceId, feedId, input) {
      updateCall = { workspaceId, sourceId, feedId, input };
      return {
        id: feedId, workspaceId, sourceConnectionId: sourceId, providerFeedId: '-1001',
        displayName: input.displayName, feedType: 'telegram_chat', isActive: input.enabled,
      };
    },
  };

  const response = await handleAuthorizedV1AdminSourcesRequest(
    request('/api/v1/admin/sources/source-1/feeds/feed-1', 'PUT', { displayName: 'Gold Room', enabled: false }),
    auth(),
    { sourceStore },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.feed.id, 'feed-1');
  assert.equal(body.feed.displayName, 'Gold Room');
  assert.equal(body.feed.isActive, false);
  assert.deepEqual(updateCall, {
    workspaceId: 'ws-1', sourceId: 'source-1', feedId: 'feed-1', input: { displayName: 'Gold Room', enabled: false },
  });
});

test('route can be edited in place including feed scope destination priority and filters', async () => {
  let updateCall = null;
  const destinationStore = {
    async updateRoute(workspaceId, id, input) {
      updateCall = { workspaceId, id, input };
      return {
        id, workspace_id: workspaceId, source_connection_id: input.sourceConnectionId,
        source_feed_id: input.sourceFeedId, destination_id: input.destinationId,
        route_name: input.routeName, priority: input.priority, filters: input.filters, is_active: true,
      };
    },
  };

  const response = await handleAuthorizedV1AdminDestinationsRequest(
    request('/api/v1/admin/routes/route-1', 'PUT', {
      sourceConnectionId: 'source-1', sourceFeedId: 'feed-2', destinationId: 'dest-2',
      routeName: 'Gold only to MT5', priority: 5,
      filters: { allowedCanonicalSymbols: ['xauusd'] },
    }),
    auth(),
    { destinationStore },
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.route.id, 'route-1');
  assert.equal(body.route.sourceFeedId, 'feed-2');
  assert.equal(body.route.destinationId, 'dest-2');
  assert.deepEqual(body.route.filters.allowedCanonicalSymbols, ['XAUUSD']);
  assert.equal(updateCall.id, 'route-1');
});

test('destination partial edit preserves unspecified bot connection template ref and settings', async () => {
  let patch = null;
  const destinationStore = {
    async getDestination() {
      return {
        id: 'dest-1', workspace_id: 'ws-1', destination_type: 'telegram', display_name: 'Old name',
        destination_ref: '-1001', template_id: 'tpl-1', credential_connection_id: 'bot-1',
        settings: { timeoutMs: 5000 }, is_active: true, health_status: 'HEALTHY',
      };
    },
    async updateDestination(workspaceId, id, input) {
      patch = input;
      return {
        id, workspace_id: workspaceId, destination_type: 'telegram', display_name: input.displayName,
        destination_ref: input.destinationRef, template_id: input.templateId,
        credential_connection_id: input.credentialConnectionId, settings: input.settings,
        is_active: true, health_status: 'HEALTHY',
      };
    },
  };

  const response = await handleAuthorizedV1AdminDestinationsRequest(
    request('/api/v1/admin/destinations/dest-1', 'PUT', { displayName: 'Renamed VIP' }),
    auth(),
    { destinationStore },
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.destination.displayName, 'Renamed VIP');
  assert.equal(body.destination.destinationRef, '-1001');
  assert.equal(body.destination.templateId, 'tpl-1');
  assert.equal(body.destination.credentialConnectionId, 'bot-1');
  assert.deepEqual(patch.settings, { timeoutMs: 5000 });
});

test('template partial edit preserves unspecified formatting and branding fields', async () => {
  let patch = null;
  const destinationStore = {
    async getTemplate() {
      return {
        id: 'tpl-1', workspace_id: 'ws-1', template_name: 'Original', formatting_mode: 'ai_then_fallback',
        parse_mode: 'HTML', brand_name: 'Starpips', header: 'SIGNAL', footer: 'Risk properly', disclaimer: 'Demo',
        emoji_style: 'standard', cleanup_rules: { removeLinks: true }, layout: { fieldOrder: ['symbol'] }, is_default: true,
      };
    },
    async updateTemplate(workspaceId, id, input) {
      patch = input;
      return {
        id, workspace_id: workspaceId, template_name: input.templateName, formatting_mode: input.formattingMode,
        parse_mode: input.parseMode, brand_name: input.brandName, header: input.header, footer: input.footer,
        disclaimer: input.disclaimer, emoji_style: input.emojiStyle, cleanup_rules: input.cleanupRules,
        layout: input.layout, is_default: input.isDefault,
      };
    },
  };

  const response = await handleAuthorizedV1AdminDestinationsRequest(
    request('/api/v1/admin/templates/tpl-1', 'PUT', { templateName: 'Renamed template' }),
    auth(),
    { destinationStore },
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.template.templateName, 'Renamed template');
  assert.equal(body.template.formattingMode, 'ai_then_fallback');
  assert.equal(body.template.brandName, 'Starpips');
  assert.equal(body.template.header, 'SIGNAL');
  assert.deepEqual(patch.cleanupRules, { removeLinks: true });
});

test('saved Telegram delivery bot can be renamed in place without rotating its token', async () => {
  let updateCall = null;
  const connectionStore = {
    async updateConnection(workspaceId, id, input) {
      updateCall = { workspaceId, id, input };
      return {
        id, workspace_id: workspaceId, provider_type: 'telegram_bot_api', display_name: input.displayName,
        credential_ciphertext: 'still-existing-secret', is_active: true,
      };
    },
  };

  const response = await handleAuthorizedV1AdminDestinationConnectionsRequest(
    request('/api/v1/admin/destination-connections/bot-1', 'PUT', { displayName: 'Primary delivery bot' }),
    auth(),
    { connectionStore },
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.destinationConnection.id, 'bot-1');
  assert.equal(body.destinationConnection.displayName, 'Primary delivery bot');
  assert.equal(JSON.stringify(body).includes('still-existing-secret'), false);
  assert.deepEqual(updateCall, { workspaceId: 'ws-1', id: 'bot-1', input: { displayName: 'Primary delivery bot' } });
});
