const RUNTIME_STATE_KEY = 'mtproto_runtime_state_v1';
const HEALTH_PORT = 8080;

function requiredString(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function normalizeIdentity(input = {}) {
  return {
    sourceId: requiredString(input.sourceId, 'sourceId'),
    workspaceId: requiredString(input.workspaceId, 'workspaceId'),
    accountScope: requiredString(input.accountScope, 'accountScope'),
  };
}

function sameIdentity(left, right) {
  return Boolean(left && right)
    && left.sourceId === right.sourceId
    && left.workspaceId === right.workspaceId
    && left.accountScope === right.accountScope;
}

function normalizeChatIds(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('bootstrap.chatIds must contain at least one Telegram chat id');
  }
  return [...new Set(value.map((item) => requiredString(item, 'bootstrap.chatId')))];
}

function runtimeEnv(identity, bootstrap = {}) {
  const apiId = Number(bootstrap.apiId);
  if (!Number.isInteger(apiId) || apiId <= 0) throw new TypeError('bootstrap.apiId must be a positive integer');

  return {
    MTPROTO_API_ID: String(apiId),
    MTPROTO_API_HASH: requiredString(bootstrap.apiHash, 'bootstrap.apiHash'),
    MTPROTO_SESSION_STRING: requiredString(bootstrap.sessionString, 'bootstrap.sessionString'),
    MTPROTO_SOURCE_ID: identity.sourceId,
    MTPROTO_WORKSPACE_ID: identity.workspaceId,
    MTPROTO_ACCOUNT_SCOPE: identity.accountScope,
    MTPROTO_CHAT_IDS_JSON: JSON.stringify(normalizeChatIds(bootstrap.chatIds)),
    MTPROTO_INTERNAL_SOURCE_URL: requiredString(bootstrap.internalSourceUrl, 'bootstrap.internalSourceUrl'),
    MTPROTO_INTERNAL_SOURCE_TOKEN: requiredString(bootstrap.internalSourceToken, 'bootstrap.internalSourceToken'),
  };
}

function publicState(state = {}, running = false) {
  return {
    status: state.status ?? (running ? 'STARTING' : 'STOPPED'),
    running: Boolean(running),
    connected: Boolean(state.connected),
    lastHeartbeatAt: state.lastHeartbeatAt ?? null,
    lastEventAt: state.lastEventAt ?? null,
    restartCount: Number.isFinite(state.restartCount) ? state.restartCount : 0,
  };
}

export class MtprotoContainerRuntime {
  constructor(ctx, env = {}) {
    this.ctx = ctx;
    this.env = env;
  }

  async _loadState() {
    return (await this.ctx.storage.get(RUNTIME_STATE_KEY)) || {};
  }

  async _saveState(next) {
    await this.ctx.storage.put(RUNTIME_STATE_KEY, next);
    return next;
  }

  async _bindIdentity(input) {
    const identity = normalizeIdentity(input);
    const current = await this._loadState();
    if (current.identity && !sameIdentity(current.identity, identity)) {
      throw new Error('RUNTIME_IDENTITY_MISMATCH');
    }
    if (!current.identity) {
      await this._saveState({
        ...current,
        identity,
        desiredState: current.desiredState ?? 'STOPPED',
        restartCount: Number(current.restartCount || 0),
      });
    }
    return identity;
  }

  _startContainer(envVars) {
    // Low-level Container API gives this stateful DO direct lifecycle control.
    // Secrets exist only in the start call/environment and are never stored in
    // Durable Object storage or returned from runtimeStatus().
    this.ctx.container.start({
      env: envVars,
      enableInternet: true,
    });
  }

  async _probeHealth() {
    if (!this.ctx.container.running) return null;
    try {
      const port = this.ctx.container.getTcpPort(HEALTH_PORT);
      const response = await port.fetch('http://container/health', { method: 'GET' });
      if (!response.ok) return null;
      const body = await response.json();
      return body && typeof body === 'object' ? body : null;
    } catch {
      return null;
    }
  }

  async ensureStarted(input = {}) {
    const identity = await this._bindIdentity(input);
    const current = await this._loadState();

    if (!this.ctx.container.running) {
      const envVars = runtimeEnv(identity, input.bootstrap);
      await this._saveState({
        ...current,
        identity,
        desiredState: 'RUNNING',
        status: 'STARTING',
        connected: false,
      });
      this._startContainer(envVars);
    } else if (current.desiredState !== 'RUNNING') {
      await this._saveState({ ...current, identity, desiredState: 'RUNNING' });
    }

    return this.runtimeStatus();
  }

  async stopRuntime() {
    const current = await this._loadState();
    await this._saveState({
      ...current,
      desiredState: 'STOPPED',
      status: 'STOPPING',
      connected: false,
    });
    if (this.ctx.container.running) {
      await this.ctx.container.destroy('MTPROTO_RUNTIME_STOPPED');
    }
    const stopped = await this._loadState();
    await this._saveState({ ...stopped, status: 'DISABLED', connected: false });
    return this.runtimeStatus();
  }

  async restartRuntime(input = {}) {
    const identity = await this._bindIdentity(input);
    const current = await this._loadState();
    const envVars = runtimeEnv(identity, input.bootstrap);

    await this._saveState({
      ...current,
      identity,
      desiredState: 'RUNNING',
      status: 'RESTARTING',
      connected: false,
      restartCount: Number(current.restartCount || 0) + 1,
    });
    if (this.ctx.container.running) {
      await this.ctx.container.destroy('MTPROTO_RUNTIME_RESTART');
    }
    this._startContainer(envVars);
    return this.runtimeStatus();
  }

  async runtimeStatus() {
    const current = await this._loadState();
    const running = Boolean(this.ctx.container.running);
    const health = running ? await this._probeHealth() : null;

    if (health) {
      const next = {
        ...current,
        status: health.status === 'HEALTHY' ? 'HEALTHY' : String(health.status || 'DEGRADED'),
        connected: Boolean(health.connected),
        lastHeartbeatAt: new Date().toISOString(),
        lastEventAt: health.last_event_at ?? current.lastEventAt ?? null,
      };
      await this._saveState(next);
      return publicState(next, running);
    }

    if (!running && current.desiredState === 'RUNNING') {
      const next = { ...current, status: 'DEGRADED', connected: false };
      await this._saveState(next);
      return publicState(next, false);
    }

    return publicState(current, running);
  }
}
