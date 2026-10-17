import { TradeStateStore, TradeStateCoordinator } from './trade_state_store.js';
import { createSupabaseTradeStatePersistence } from '../persistence/supabase_trade_state_persistence.js';
import { resolveTradingStorageAuthority } from '../persistence/trading_storage_authority.js';
import { createPostgresTradingDatabase } from '../persistence/postgres_database.js';
import { createTradingTradeStatePersistence } from '../persistence/trading_trade_state_repository.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

async function body(request) {
  try { return await request.json(); } catch { return null; }
}

function workspaceHeader(request) {
  return String(request.headers.get('x-mkety-workspace-id') || '').trim();
}

function hasSupabaseCredentials(env = {}) {
  return Boolean(env.SUPABASE_URL && (env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY));
}

function storageRuntimeEnabled(env = {}) {
  return /^(1|true|yes|on)$/i.test(String(env.TRADING_STORAGE_RUNTIME_ENABLED || '').trim());
}

async function withTradingPersistence(env, method, ...args) {
  const authority = resolveTradingStorageAuthority(env);
  let postgresDatabase = null;
  try {
    if (authority.kind === 'postgres') postgresDatabase = await createPostgresTradingDatabase(authority.binding);
    const persistence = createTradingTradeStatePersistence({ authority, postgresDatabase });
    return await persistence[method](...args);
  } finally {
    await postgresDatabase?.close();
  }
}

function lazyPersistence(promise, env = {}) {
  return {
    async saveGroup(group) {
      if (storageRuntimeEnabled(env)) return withTradingPersistence(env, 'saveGroup', group);
      const persistence = await promise;
      return persistence ? persistence.saveGroup(group) : group;
    },
    async loadGroup(workspaceId, groupId) {
      if (storageRuntimeEnabled(env)) return withTradingPersistence(env, 'loadGroup', workspaceId, groupId);
      const persistence = await promise;
      return persistence ? persistence.loadGroup(workspaceId, groupId) : null;
    },
    async loadActive(workspaceId) {
      if (storageRuntimeEnabled(env)) return withTradingPersistence(env, 'loadActive', workspaceId);
      const persistence = await promise;
      return persistence ? persistence.loadActive(workspaceId) : [];
    },
  };
}

export class TradeStateNode {
  constructor(state, env = {}) {
    this.state = state;
    this.env = env;
    const persistencePromise = storageRuntimeEnabled(env)
      ? Promise.resolve(null)
      : (hasSupabaseCredentials(env) ? createSupabaseTradeStatePersistence(env) : Promise.resolve(null));
    this.persistence = lazyPersistence(persistencePromise, env);
    this.store = new TradeStateStore(state.storage, { persistence: this.persistence });
    this.coordinator = new TradeStateCoordinator(this.store, {
      correlationWindowMs: Number(env.TRADE_CORRELATION_WINDOW_MS || 120000),
    });
    this.workspaceStores = new Map();
  }

  authorized(request) {
    const expected = String(this.env.TRADE_STATE_INTERNAL_TOKEN || '');
    const received = String(request.headers.get('x-mkety-internal-token') || '');
    return Boolean(expected && received && expected === received);
  }

  runtimeForWorkspace(workspaceId) {
    const id = String(workspaceId || '').trim();
    if (!id) return { store: this.store, coordinator: this.coordinator };
    if (!this.workspaceStores.has(id)) {
      const store = new TradeStateStore(this.state.storage, { persistence: this.persistence, workspaceId: id });
      this.workspaceStores.set(id, {
        store,
        coordinator: new TradeStateCoordinator(store, {
          correlationWindowMs: Number(this.env.TRADE_CORRELATION_WINDOW_MS || 120000),
        }),
      });
    }
    return this.workspaceStores.get(id);
  }

  async fetch(request) {
    if (!this.authorized(request)) return json({ error: 'unauthorized' }, 401);
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();
    const headerWorkspaceId = workspaceHeader(request);

    if (method === 'GET' && path === '/groups/active') {
      const { store } = this.runtimeForWorkspace(headerWorkspaceId);
      return json({ groups: await store.listActive() });
    }

    if (method === 'POST' && path === '/groups') {
      const group = await body(request);
      if (!group?.id) return json({ error: 'group id required' }, 400);
      const workspaceId = headerWorkspaceId || String(group.workspaceId || '').trim();
      if (headerWorkspaceId && group?.workspaceId && String(group.workspaceId) !== headerWorkspaceId) {
        return json({ error: 'workspace mismatch' }, 400);
      }
      const { store } = this.runtimeForWorkspace(workspaceId);
      return json(await store.putGroup(group), 201);
    }

    if (method === 'POST' && path === '/correlate') {
      const payload = await body(request);
      if (!payload?.event || !payload?.interpretation) return json({ error: 'event and interpretation required' }, 400);
      const workspaceId = headerWorkspaceId || String(payload.event?.workspace_hint || '').trim();
      const { coordinator } = this.runtimeForWorkspace(workspaceId);
      return json(await coordinator.correlate(payload.event, payload.interpretation, payload.nowMs ?? Date.now()));
    }

    const { store } = this.runtimeForWorkspace(headerWorkspaceId);
    const pendingSnapshotMatch = path.match(/^\/groups\/([^/]+)\/legs\/([^/]+)\/pending-order-snapshot$/);
    if (method === 'POST' && pendingSnapshotMatch) {
      if (!headerWorkspaceId) return json({ error: 'workspace header required' }, 400);
      const payload = await body(request) || {};
      if (!payload.tradeAccountId || !payload.brokerOrderId || !payload.snapshot || typeof payload.snapshot !== 'object') {
        return json({ error: 'tradeAccountId, brokerOrderId, and snapshot are required' }, 400);
      }
      const result = await store.reconcilePendingOrderSnapshot(
        decodeURIComponent(pendingSnapshotMatch[1]),
        decodeURIComponent(pendingSnapshotMatch[2]),
        payload,
      );
      return json(result);
    }

    const brokerObservationMatch = path.match(/^\/groups\/([^/]+)\/legs\/([^/]+)\/broker-observation$/);
    if (method === 'POST' && brokerObservationMatch) {
      if (!headerWorkspaceId) return json({ error: 'workspace header required' }, 400);
      const payload = await body(request) || {};
      const result = await store.recordBrokerObservation(
        decodeURIComponent(brokerObservationMatch[1]),
        decodeURIComponent(brokerObservationMatch[2]),
        payload,
      );
      return json(result);
    }

    const groupMatch = path.match(/^\/groups\/([^/]+)$/);
    if (method === 'GET' && groupMatch) {
      const group = await store.getGroup(decodeURIComponent(groupMatch[1]));
      return group ? json(group) : json({ error: 'not found' }, 404);
    }

    const sourceEventMatch = path.match(/^\/groups\/([^/]+)\/source-events$/);
    if (method === 'POST' && sourceEventMatch) {
      const payload = await body(request);
      if (payload?.externalEventId == null) return json({ error: 'externalEventId required' }, 400);
      const group = await store.appendSourceEvent(
        decodeURIComponent(sourceEventMatch[1]),
        payload.externalEventId,
        payload.nowMs ?? Date.now(),
      );
      return json(group);
    }

    const bindMatch = path.match(/^\/groups\/([^/]+)\/legs\/([^/]+)\/execution$/);
    if (method === 'POST' && bindMatch) {
      const payload = await body(request) || {};
      const { nowMs, ...execution } = payload;
      const group = await store.bindLegExecution(
        decodeURIComponent(bindMatch[1]),
        decodeURIComponent(bindMatch[2]),
        execution,
        nowMs ?? Date.now(),
      );
      return json(group);
    }

    return json({ error: 'not found' }, 404);
  }
}
