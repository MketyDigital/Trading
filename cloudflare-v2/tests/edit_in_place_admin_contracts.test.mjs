import test from 'node:test';
import assert from 'node:assert/strict';

import { handleV1AdminEditInPlaceRequest } from '../src/http/v1_admin_edit_in_place.js';

function request(path, method = 'PUT', body = {}) {
  return new Request(`https://trade.mkety.com${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Mkety-Workspace-Id': 'ws-1' },
    body: JSON.stringify(body),
  });
}

function memorySupabase(seed = {}) {
  const tables = Object.fromEntries(Object.entries(seed).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]));
  function from(name) {
    if (!tables[name]) tables[name] = [];
    const state = { filters: [], inFilters: [], operation: 'select', patch: null };
    const query = {
      select() { return query; },
      eq(field, value) { state.filters.push([field, value]); return query; },
      in(field, values) { state.inFilters.push([field, values]); return query; },
      update(patch) { state.operation = 'update'; state.patch = patch; return query; },
      upsert(rows, options = {}) {
        const conflict = String(options.onConflict || '').split(',').map((x) => x.trim()).filter(Boolean);
        for (const incoming of rows) {
          const index = tables[name].findIndex((row) => conflict.length && conflict.every((key) => String(row[key]) === String(incoming[key])));
          if (index >= 0) tables[name][index] = { ...tables[name][index], ...incoming };
          else tables[name].push({ id: incoming.id || `${name}-${tables[name].length + 1}`, ...incoming });
        }
        return Promise.resolve({ data: rows, error: null });
      },
      async maybeSingle() {
        const result = execute();
        return { data: result.data[0] || null, error: null };
      },
      then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
    };
    function matches(row) {
      return state.filters.every(([field, value]) => String(row[field]) === String(value))
        && state.inFilters.every(([field, values]) => values.map(String).includes(String(row[field])));
    }
    function execute() {
      const matched = tables[name].filter(matches);
      if (state.operation === 'update') {
        for (const row of matched) Object.assign(row, state.patch);
      }
      return { data: matched, error: null };
    }
    return query;
  }
  return { from, tables };
}

function deps(db) {
  return {
    supabaseFactory: async () => db,
    authorizeFn: async () => ({ ok: true, workspace: { id: 'ws-1' }, membership: { role: 'owner', enabled: true } }),
  };
}

test('source edit keeps id and reconciles Telegram child feeds without recreating source', async () => {
  const db = memorySupabase({
    source_connections: [{
      id: 'source-1', workspace_id: 'ws-1', provider_type: 'external_mtproto', source_family: 'telegram',
      source_type: 'telegram_mtproto', source_instance_id: 'main-userbot', display_name: 'Old source', external_identity: 'acct-1',
      priority: 10, config: { chat_acceptance_mode: 'allowlist', allowed_chat_ids: ['-1001'] }, is_active: true,
    }],
    source_feeds: [{ id: 'feed-1', workspace_id: 'ws-1', source_connection_id: 'source-1', provider_feed_id: '-1001', display_name: null, feed_type: 'telegram_chat', is_active: true, metadata: {} }],
  });
  const response = await handleV1AdminEditInPlaceRequest(request('/api/v1/admin/sources/source-1', 'PUT', {
    displayName: 'Main userbot', priority: 3,
    config: { chat_acceptance_mode: 'allowlist', allowed_chat_ids: ['-1001', '-1002'] },
  }), {}, deps(db));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.source.id, 'source-1');
  assert.equal(body.source.displayName, 'Main userbot');
  assert.equal(db.tables.source_connections.length, 1);
  assert.deepEqual(db.tables.source_feeds.filter((row) => row.is_active).map((row) => row.provider_feed_id).sort(), ['-1001', '-1002']);
});

test('removing an allowed Telegram chat deactivates its child feed instead of deleting/recreating objects', async () => {
  const db = memorySupabase({
    source_connections: [{ id: 'source-1', workspace_id: 'ws-1', provider_type: 'telegram_bot_api', source_family: 'telegram', source_type: 'telegram_bot', source_instance_id: 'bot', display_name: 'Bot', priority: 0, config: { allowed_chat_ids: ['-1001', '-1002'] }, is_active: true }],
    source_feeds: [
      { id: 'feed-1', workspace_id: 'ws-1', source_connection_id: 'source-1', provider_feed_id: '-1001', feed_type: 'telegram_chat', is_active: true, metadata: {} },
      { id: 'feed-2', workspace_id: 'ws-1', source_connection_id: 'source-1', provider_feed_id: '-1002', feed_type: 'telegram_chat', is_active: true, metadata: {} },
    ],
  });
  const response = await handleV1AdminEditInPlaceRequest(request('/api/v1/admin/sources/source-1', 'PATCH', {
    config: { allowed_chat_ids: ['-1001'] },
  }), {}, deps(db));
  assert.equal(response.status, 200);
  assert.equal(db.tables.source_feeds.find((row) => row.id === 'feed-1').is_active, true);
  assert.equal(db.tables.source_feeds.find((row) => row.id === 'feed-2').is_active, false);
});

test('source feed label and state are editable in place', async () => {
  const db = memorySupabase({ source_feeds: [{ id: 'feed-1', workspace_id: 'ws-1', source_connection_id: 'source-1', provider_feed_id: '-1001', display_name: null, feed_type: 'telegram_chat', is_active: true, metadata: {} }] });
  const response = await handleV1AdminEditInPlaceRequest(request('/api/v1/admin/sources/source-1/feeds/feed-1', 'PUT', { displayName: 'Gold Room', enabled: false }), {}, deps(db));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.feed.id, 'feed-1');
  assert.equal(body.feed.displayName, 'Gold Room');
  assert.equal(body.feed.isActive, false);
  assert.equal(db.tables.source_feeds.length, 1);
});

test('route can be edited in place including feed scope destination priority and filters', async () => {
  const db = memorySupabase({ source_destination_routes: [{ id: 'route-1', workspace_id: 'ws-1', source_connection_id: 'source-1', source_feed_id: null, destination_id: 'dest-1', route_name: 'Old', priority: 100, is_active: true, filters: {} }] });
  const response = await handleV1AdminEditInPlaceRequest(request('/api/v1/admin/routes/route-1', 'PUT', {
    sourceFeedId: 'feed-2', destinationId: 'dest-2', routeName: 'Gold only to MT5', priority: 5,
    filters: { allowedCanonicalSymbols: ['xauusd'] },
  }), {}, deps(db));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.route.id, 'route-1');
  assert.equal(body.route.sourceFeedId, 'feed-2');
  assert.equal(body.route.destinationId, 'dest-2');
  assert.deepEqual(body.route.filters.allowedCanonicalSymbols, ['XAUUSD']);
  assert.equal(db.tables.source_destination_routes.length, 1);
});

test('destination partial edit preserves omitted ref template bot connection settings and legacy credential', async () => {
  const db = memorySupabase({ trading_destinations: [{
    id: 'dest-1', workspace_id: 'ws-1', destination_type: 'telegram', display_name: 'Old name', destination_ref: '-1001',
    template_id: 'tpl-1', credential_connection_id: 'bot-1', credential_ciphertext: 'legacy-secret-cipher', settings: { timeoutMs: 5000 },
    is_active: true, health_status: 'HEALTHY',
  }] });
  const response = await handleV1AdminEditInPlaceRequest(request('/api/v1/admin/destinations/dest-1', 'PATCH', { displayName: 'Renamed VIP' }), {}, deps(db));
  assert.equal(response.status, 200);
  const body = await response.json();
  const row = db.tables.trading_destinations[0];
  assert.equal(body.destination.displayName, 'Renamed VIP');
  assert.equal(row.destination_ref, '-1001');
  assert.equal(row.template_id, 'tpl-1');
  assert.equal(row.credential_connection_id, 'bot-1');
  assert.equal(row.credential_ciphertext, 'legacy-secret-cipher');
  assert.deepEqual(row.settings, { timeoutMs: 5000 });
  assert.equal(JSON.stringify(body).includes('legacy-secret-cipher'), false);
});

test('template partial edit preserves unspecified formatting and branding fields', async () => {
  const db = memorySupabase({ trading_destination_templates: [{
    id: 'tpl-1', workspace_id: 'ws-1', template_name: 'Original', formatting_mode: 'ai_then_fallback', parse_mode: 'HTML',
    brand_name: 'Starpips', header: 'SIGNAL', footer: 'Risk properly', disclaimer: 'Demo', emoji_style: 'standard',
    cleanup_rules: { removeLinks: true }, layout: { fieldOrder: ['symbol'] }, is_default: true,
  }] });
  const response = await handleV1AdminEditInPlaceRequest(request('/api/v1/admin/templates/tpl-1', 'PUT', { templateName: 'Renamed template' }), {}, deps(db));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.template.templateName, 'Renamed template');
  assert.equal(body.template.formattingMode, 'ai_then_fallback');
  assert.equal(body.template.brandName, 'Starpips');
  assert.equal(body.template.header, 'SIGNAL');
  assert.deepEqual(body.template.cleanupRules, { removeLinks: true });
});

test('saved Telegram delivery bot can be renamed without rotating or exposing token ciphertext', async () => {
  const db = memorySupabase({ trading_destination_connections: [{ id: 'bot-1', workspace_id: 'ws-1', provider_type: 'telegram_bot_api', display_name: 'Old bot', credential_ciphertext: 'still-existing-secret', is_active: true }] });
  const response = await handleV1AdminEditInPlaceRequest(request('/api/v1/admin/destination-connections/bot-1', 'PUT', { displayName: 'Primary delivery bot' }), {}, deps(db));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.destinationConnection.id, 'bot-1');
  assert.equal(body.destinationConnection.displayName, 'Primary delivery bot');
  assert.equal(db.tables.trading_destination_connections[0].credential_ciphertext, 'still-existing-secret');
  assert.equal(JSON.stringify(body).includes('still-existing-secret'), false);
});

test('storage-runtime edit-in-place updates use selected repositories and never create Supabase', async () => {
  let supabaseFactoryCalls = 0;
  const updates = [];
  const runtime = {
    accessCodes: {}, workspaceAccess: {}, hostnames: {},
    sourceConnections: {
      getSourceForAdmin: async () => ({ id: 'source-1', workspace_id: 'ws-1', provider_type: 'custom_signed_api', source_family: 'api', display_name: 'Old source', config: {} }),
      update: async (_workspace, id, patch) => { updates.push(['source', id, patch]); return { id, workspace_id: 'ws-1', provider_type: 'custom_signed_api', source_family: 'api', ...patch }; },
    },
    sourceFeeds: {
      listFeeds: async () => [{ id: 'feed-1', workspace_id: 'ws-1', source_connection_id: 'source-1', provider_feed_id: 'feed-native', is_active: true }],
      update: async (_workspace, id, patch) => { updates.push(['feed', id, patch]); return { id, workspace_id: 'ws-1', source_connection_id: 'source-1', provider_feed_id: 'feed-native', ...patch }; },
    },
    destinations: {
      listDestinations: async () => [{ id: 'dest-1', workspace_id: 'ws-1', destination_type: 'telegram', display_name: 'Old destination', destination_ref: '-1001', template_id: 'tpl-1', credential_connection_id: 'bot-1', settings: { timeoutMs: 5000 } }],
      updateDestination: async (_workspace, id, input) => { updates.push(['destination', id, input]); return { id, workspace_id: 'ws-1', destination_type: 'telegram', display_name: input.displayName, destination_ref: input.destinationRef, template_id: input.templateId, credential_connection_id: input.credentialConnectionId, settings: input.settings }; },
      listTemplates: async () => [{ id: 'tpl-1', workspace_id: 'ws-1', template_name: 'Original', formatting_mode: 'ai_then_fallback', parse_mode: 'HTML', brand_name: 'Brand', header: 'Signal', footer: 'Risk', disclaimer: 'Demo', emoji_style: 'standard', cleanup_rules: { removeLinks: true }, layout: { fieldOrder: ['symbol'] }, is_default: true }],
      updateTemplate: async (_workspace, id, input) => { updates.push(['template', id, input]); return { id, workspace_id: 'ws-1', template_name: input.templateName, formatting_mode: input.formattingMode, parse_mode: input.parseMode, brand_name: input.brandName, header: input.header, footer: input.footer, disclaimer: input.disclaimer, emoji_style: input.emojiStyle, cleanup_rules: input.cleanupRules, layout: input.layout, is_default: input.isDefault }; },
      listConnections: async () => [{ id: 'bot-1', workspace_id: 'ws-1', provider_type: 'telegram_bot_api', display_name: 'Old bot', credential_ciphertext: 'secret-cipher', is_active: true }],
      updateConnection: async (_workspace, id, input) => { updates.push(['connection', id, input]); return { id, workspace_id: 'ws-1', provider_type: 'telegram_bot_api', display_name: input.displayName || 'Old bot', credential_ciphertext: 'secret-cipher', is_active: input.enabled ?? true }; },
    },
    routes: {
      list: async () => [{ id: 'route-1', workspace_id: 'ws-1', source_connection_id: 'source-1', source_feed_id: null, destination_id: 'dest-1', priority: 100, filters: {} }],
      update: async (_workspace, id, patch) => { updates.push(['route', id, patch]); return { id, workspace_id: 'ws-1', source_connection_id: 'source-1', source_feed_id: null, destination_id: 'dest-1', filters: {}, ...patch }; },
    },
  };
  const options = {
    persistenceRuntime: runtime,
    supabaseFactory: async () => { supabaseFactoryCalls += 1; throw new Error('Supabase must not be opened'); },
    authorizeFn: async () => ({ ok: true, workspace: { id: 'ws-1' }, membership: { role: 'owner', enabled: true } }),
  };
  const cases = [
    ['/api/v1/admin/sources/source-1', { displayName: 'Renamed source' }],
    ['/api/v1/admin/sources/source-1/feeds/feed-1', { enabled: false }],
    ['/api/v1/admin/destinations/dest-1', { displayName: 'Renamed destination' }],
    ['/api/v1/admin/templates/tpl-1', { templateName: 'Renamed template' }],
    ['/api/v1/admin/routes/route-1', { priority: 7 }],
    ['/api/v1/admin/destination-connections/bot-1', { displayName: 'Renamed bot' }],
  ];

  for (const [path, body] of cases) {
    const response = await handleV1AdminEditInPlaceRequest(request(path, 'PATCH', body), {}, options);
    assert.equal(response.status, 200, `${path} should preserve in-place editing in storage mode`);
    assert.equal((await response.json()).ok, true);
  }
  assert.equal(supabaseFactoryCalls, 0);
  assert.deepEqual(updates.map(([domain]) => domain), ['source', 'feed', 'destination', 'template', 'route', 'connection']);
  const templateUpdate = updates.find(([domain]) => domain === 'template')[2];
  assert.equal(templateUpdate.formattingMode, 'ai_then_fallback');
  assert.deepEqual(templateUpdate.cleanupRules, { removeLinks: true });
  const destinationUpdate = updates.find(([domain]) => domain === 'destination')[2];
  assert.equal(destinationUpdate.credentialConnectionId, 'bot-1');
  assert.deepEqual(destinationUpdate.settings, { timeoutMs: 5000 });
});
