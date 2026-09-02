import { Container } from '@cloudflare/containers';

const RUNTIME_STATE_KEY = 'mtproto_runtime_state_v1';

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

export class MtprotoContainerRuntime extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  sleepAfter = '10m';

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
      await this.startAndWaitForPorts({ startOptions: { envVars } });
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
    if (this.ctx.container.running) await this.stop();
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
    if (this.ctx.container.running) await this.stop();
    await this.startAndWaitForPorts({ startOptions: { envVars } });
    return this.runtimeStatus();
  }

  async runtimeStatus() {
    const state = await this._loadState();
    return publicState(state, this.ctx.container.running);
  }

  async onStart() {
    const current = await this._loadState();
    await this._saveState({
      ...current,
      status: 'HEALTHY',
      connected: false,
      lastHeartbeatAt: new Date().toISOString(),
    });
  }

  async onStop() {
    const current = await this._loadState();
    const intentional = current.desiredState === 'STOPPED';
    await this._saveState({
      ...current,
      status: intentional ? 'DISABLED' : 'DEGRADED',
      connected: false,
      lastHeartbeatAt: new Date().toISOString(),
    });
  }

  async onError() {
    const current = await this._loadState();
    await this._saveState({
      ...current,
      status: 'ERROR',
      connected: false,
      lastHeartbeatAt: new Date().toISOString(),
    });
  }

  async onActivityExpired() {
    const current = await this._loadState();
    if (current.desiredState !== 'RUNNING') {
      await this.stop();
    }
    // Enabled MTProto listeners are intentionally long-lived. The container's
    // local filesystem is never treated as durable state; identity/lifecycle
    // state lives in this Durable Object and Telegram catch-up handles replay.
  }
}
