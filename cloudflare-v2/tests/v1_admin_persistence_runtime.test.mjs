import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleV1AdminRequest } from '../src/http/v1_admin.js';
import { createLocalTradingBearer } from '../src/access/trading_access_codes.js';
import { createTradingPersistenceRuntime } from '../src/persistence/trading_persistence_runtime.js';

class D1 {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) {
    const state = { sql, values: [] };
    const statement = {
      bind: (...values) => { state.values = values; return statement; },
      first: () => this.sqlite.prepare(state.sql).get(...state.values) || null,
      all: () => ({ results: this.sqlite.prepare(state.sql).all(...state.values) }),
      run: () => ({ meta: { changes: Number(this.sqlite.prepare(state.sql).run(...state.values).changes) } }),
    };
    return statement;
  }
  batch(statements) { this.sqlite.exec('BEGIN'); try { const results = statements.map((statement) => statement.run()); this.sqlite.exec('COMMIT'); return results; } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; } }
}

function setup() {
  const events = [];
  const workspaceAccess = {
    async getWorkspace(id) { events.push(['workspace', id]); return { id, display_name: 'Tenant', owner_email: 'owner@example.com', trading_access_enabled: true, metadata: {} }; },
    async getMembership(workspaceId, subject) { events.push(['membership', workspaceId, subject]); return { id: 'm1', workspaceId, subject, role: 'owner', enabled: true, metadata: {} }; },
    async listMemberships() { return []; },
  };
  const aiProviders = {
    async list(workspaceId) { events.push(['ai-list', workspaceId]); return [{ id: 'ai1', workspace_id: workspaceId, provider_name: 'openai', model_name: 'model' }]; },
    async get() { return null; }, async create() { throw new Error('unused'); }, async update() { throw new Error('unused'); },
    async recordHealth() { return true; }, async remove() { return true; },
  };
  const runtime = { workspaceAccess, aiProviders, async close() { events.push(['close']); } };
  const options = {
    persistenceRuntimeFactory: async () => runtime,
    supabaseFactory: async () => { throw new Error('Supabase must not be created for a persistence-runtime request'); },
    authenticateFn: async (_request, { requestedWorkspaceId }) => ({ ok: true, subject: 'u1', workspaceId: requestedWorkspaceId, access: 'owner' }),
  };
  return { options, events };
}

function request(path) {
  return new Request(`https://trade.mkety.com${path}`, { headers: { 'X-Mkety-Workspace-Id': 'ws1', Authorization: 'Bearer token' } });
}

test('V1 admin workspace and AI reads use only injected persistence repositories', async () => {
  const { options, events } = setup();
  const workspace = await handleV1AdminRequest(request('/api/v1/admin/workspace'), {}, options);
  assert.equal(workspace.status, 200);
  assert.equal((await workspace.json()).workspace.name, 'Tenant');
  const providers = await handleV1AdminRequest(request('/api/v1/admin/ai-providers'), {}, options);
  assert.equal(providers.status, 200);
  assert.equal((await providers.json()).providers[0].id, 'ai1');
  assert.equal(events.filter(([kind]) => kind === 'close').length, 2);
  assert.ok(events.some(([kind]) => kind === 'ai-list'));
});

test('V1 admin validates local bearer subscription with the injected access-code repository', async () => {
  let accessCodeLookups = 0;
  const runtime = {
    workspaceAccess: {
      async getWorkspace(id) { return { id, display_name: 'Tenant', owner_email: null, trading_access_enabled: true, metadata: { accessCodeId: 'code-1' } }; },
      async getMembership(workspaceId, subject) { return { workspaceId, subject, role: 'owner', enabled: true, metadata: { accessCodeId: 'code-1' } }; },
    },
    accessCodes: {
      async getAccessCodeById(id) {
        accessCodeLookups += 1;
        return { id, workspace_id: 'ws-local', product: 'trading', status: 'active', expires_at: '2099-01-01T00:00:00.000Z' };
      },
    },
    async close() {},
  };
  const token = await createLocalTradingBearer({ workspaceId: 'ws-local', subject: 'access-code:owner@example.com', accessCodeId: 'code-1' }, 'local-session-secret');
  const response = await handleV1AdminRequest(new Request('https://trade.mkety.com/api/v1/admin/workspace', {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Mkety-Workspace-Id': 'ws-local',
    },
  }), {
    TRADING_ACCESS_CODE_SESSION_ENABLED: 'true',
    TRADING_ACCESS_CODE_SESSION_SECRET: 'local-session-secret',
  }, {
    persistenceRuntime: runtime,
    resolveHostnameFn: async () => ({ ok: true, kind: 'canonical' }),
  });
  assert.equal(response.status, 200);
  assert.equal(accessCodeLookups, 1);
});

test('persistence-runtime admin requests fail closed on domains not yet migrated', async () => {
  const { options, events } = setup();
  const response = await handleV1AdminRequest(request('/api/v1/admin/unported-domain'), {}, options);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, 'STORAGE_DOMAIN_NOT_MIGRATED');
  assert.equal(events.filter(([kind]) => kind === 'close').length, 1);
});

test('V1 admin workspace, AI and membership reads use the real D1 repositories', async () => {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of ['0001_trading_storage_replication.sql', '0002_trading_domain_schema.sql']) sqlite.exec(readFileSync(new URL(`../db/d1-migrations/${name}`, import.meta.url), 'utf8'));
  sqlite.prepare('UPDATE trading_storage_control SET writes_fenced=0 WHERE singleton_id=1').run();
  const env = { DB: new D1(sqlite), TRADING_MASTER_KEY: 'local-test-key' };
  const runtime = await createTradingPersistenceRuntime(env);
  await runtime.workspaceAccess.createWorkspace('ws1', { display_name: 'Tenant', owner_email: 'owner@example.com', trading_access_enabled: true, metadata: {} });
  await runtime.workspaceAccess.upsertMembership('ws1', 'u1', 'owner');
  await runtime.aiProviders.create('ws1', { provider_name: 'openai', model_name: 'test-model', api_key_ciphertext: 'test-ciphertext', is_active: true });
  await runtime.sourceConnections.createSource('ws1', { source_type: 'webhook', source_instance_id: 'tv1', source_family: 'tradingview', provider_type: 'tradingview_webhook', secret_ciphertext: 'v1:ingress-cipher', settings: {}, is_active: false, is_default: false, config: {}, health_status: 'DISABLED' });
  await runtime.accounts.createAccount('ws1', { label: 'Demo MT5', platform: 'mt5', accountId: '12345', serverName: 'Broker-Demo', lotSizingType: 'fixed', lotValue: 0.01, safetyPolicy: { killSwitch: true }, entryZonePolicy: { mode: 'market_if_inside' } }, 'v1:broker-cipher');
  const destination = await runtime.destinations.createDestination('ws1', { destinationType: 'audit_only', displayName: 'Audit sink', destinationRef: null, settings: {} }, null);
  await runtime.destinations.createConnection('ws1', { providerType: 'telegram_bot_api', displayName: 'Telegram bot' }, 'v1:telegram-cipher');
  const persistedSource = (await runtime.sourceConnections.listSources('ws1'))[0];
  await runtime.close();
  const options = {
    persistenceRuntimeFactory: () => createTradingPersistenceRuntime(env),
    supabaseFactory: async () => { throw new Error('Supabase must not be constructed'); },
    authenticateFn: async (_request, { requestedWorkspaceId }) => ({ ok: true, subject: 'u1', workspaceId: requestedWorkspaceId, access: 'owner' }),
  };
  const workspace = await handleV1AdminRequest(request('/api/v1/admin/workspace'), env, options);
  assert.equal(workspace.status, 200);
  assert.equal((await workspace.json()).workspace.name, 'Tenant');
  const providers = await handleV1AdminRequest(request('/api/v1/admin/ai-providers'), env, options);
  assert.equal(providers.status, 200);
  assert.equal((await providers.json()).providers[0].modelName, 'test-model');
  const members = await handleV1AdminRequest(request('/api/v1/admin/members'), env, options);
  assert.equal(members.status, 200);
  assert.equal((await members.json()).members[0].subject, 'u1');
  const sources = await handleV1AdminRequest(request('/api/v1/admin/sources'), env, options);
  assert.equal(sources.status, 200);
  const source = (await sources.json()).sources[0];
  assert.equal(source.providerType, 'tradingview_webhook');
  assert.equal('secret_ciphertext' in source, false);
  const accounts = await handleV1AdminRequest(request('/api/v1/admin/accounts'), env, options);
  assert.equal(accounts.status, 200);
  const account = (await accounts.json()).accounts[0];
  assert.equal(account.label, 'Demo MT5');
  assert.equal(account.credentialConfigured, true);
  assert.equal('credential_ciphertext' in account, false);
  const destinations = await handleV1AdminRequest(request('/api/v1/admin/destinations'), env, options);
  assert.equal(destinations.status, 200);
  assert.equal((await destinations.json()).destinations[0].displayName, 'Audit sink');
  const operations = await handleV1AdminRequest(request('/api/v1/admin/operations'), env, options);
  assert.equal(operations.status, 200);
  const snapshot = (await operations.json()).operations;
  assert.equal(snapshot.workspaceId, 'ws1');
  assert.equal(snapshot.deliveries.counts.PENDING, 0);
  assert.equal(snapshot.accountSafety.blockedCount, 1);
  const missingAudit = await handleV1AdminRequest(request('/api/v1/admin/events/not-present/audit'), env, options);
  assert.equal(missingAudit.status, 404);
  const connections = await handleV1AdminRequest(request('/api/v1/admin/destination-connections'), env, options);
  assert.equal(connections.status, 200);
  const connection = (await connections.json()).destinationConnections[0];
  assert.equal(connection.displayName, 'Telegram bot');
  assert.equal(connection.credentialConfigured, true);
  assert.equal('credential_ciphertext' in connection, false);
  const routeRequest = new Request('https://trade.mkety.com/api/v1/admin/routes', {
    method: 'POST',
    headers: { 'X-Mkety-Workspace-Id': 'ws1', Authorization: 'Bearer token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceConnectionId: persistedSource.id, destinationId: destination.id, priority: 10 }),
  });
  const route = await handleV1AdminRequest(routeRequest, env, options);
  assert.equal(route.status, 201);
  assert.equal((await route.json()).route.destinationId, destination.id);
  sqlite.close();
});
