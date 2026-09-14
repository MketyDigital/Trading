import { TradeStateStore, TradeStateCoordinator } from './trade_state_store.js';
import { createSupabaseTradeStatePersistence } from '../persistence/supabase_trade_state_persistence.js';

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

export class TradeStateNode {
  constructor(state, env = {}) {
    this.state = state;
    this.env = env;
    this.store = new TradeStateStore(state.storage);
    this.coordinator = new TradeStateCoordinator(this.store, {
      correlationWindowMs: Number(env.TRADE_CORRELATION_WINDOW_MS || 120000),
    });
    this.persistencePromise = hasSupabaseCredentials(env) ? createSupabaseTradeStatePersistence(env) : Promise.resolve(null);
    this.workspaceStores = new Map();
  }

  authorized(request) {
    const expected = String(this.env.TRADE_STATE_INTERNAL_TOKEN || '');
    const received = String(request.headers.get('x-mkety-internal-token') || '');
    return Boolean(expected && received && expected === received);
  }

  async runtimeFor(request) {
    const workspaceId = workspaceHeader(request);
    if (!workspaceId) return { store: this.store, coordinator: this.coordinator };
    if (!this.workspaceStores.has(workspaceId)) {
      const persistence = await this.persistencePromise;
      const store = new TradeStateStore(this.state.storage, { persistence, workspaceId });
      this.workspaceStores.set(workspaceId, {
        store,
        coordinator: new TradeStateCoordinator(store, {
          correlationWindowMs: Number(this.env.TRADE_CORRELATION_WINDOW_MS || 120000),
        }),
      });
    }
    return this.workspaceStores.get(workspaceId);
  }

  async fetch(request) {
    if (!this.authorized(request)) return json({ error: 'unauthorized' }, 401);
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();
    const { store, coordinator } = await this.runtimeFor(request);

    if (method === 'GET' && path === '/groups/active') {
      return json({ groups: await store.listActive() });
    }

    if (method === 'POST' && path === '/groups') {
      const group = await body(request);
      if (!group?.id) return json({ error: 'group id required' }, 400);
      const workspaceId = workspaceHeader(request);
      if (workspaceId && group?.workspaceId && String(group.workspaceId) !== workspaceId) {
        return json({ error: 'workspace mismatch' }, 400);
      }
      return json(await store.putGroup(group), 201);
    }

    if (method === 'POST' && path === '/correlate') {
      const payload = await body(request);
      if (!payload?.event || !payload?.interpretation) return json({ error: 'event and interpretation required' }, 400);
      return json(await coordinator.correlate(payload.event, payload.interpretation, payload.nowMs ?? Date.now()));
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
