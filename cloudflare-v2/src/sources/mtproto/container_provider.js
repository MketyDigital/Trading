function assertContainerSource(source) {
  if (!source || source.providerType !== 'cloudflare_container_mtproto' || source.sourceFamily !== 'telegram') {
    throw new TypeError('Source is not a Cloudflare Container MTProto provider');
  }
}

function runtimeName(source) {
  return `mtproto:${source.workspaceId}:${source.externalIdentity}`;
}

function isConfigured(source) {
  return Boolean(source?.workspaceId && source?.externalIdentity);
}

function sanitizeStatus(status = {}) {
  return {
    status: status.status ?? 'UNKNOWN',
    running: Boolean(status.running),
    connected: Boolean(status.connected),
    lastHeartbeatAt: status.lastHeartbeatAt ?? null,
    lastEventAt: status.lastEventAt ?? null,
    restartCount: Number.isFinite(status.restartCount) ? status.restartCount : 0,
  };
}

export function createContainerMtprotoProvider({ namespace } = {}) {
  if (!namespace?.getByName) {
    throw new TypeError('Cloudflare Container namespace binding is required');
  }

  function getStub(source) {
    assertContainerSource(source);
    return namespace.getByName(runtimeName(source));
  }

  return {
    async start(source, { bootstrap = null } = {}) {
      assertContainerSource(source);
      if (!source.enabled) return { started: false, status: 'DISABLED' };
      if (!isConfigured(source)) return { started: false, status: 'UNCONFIGURED' };

      const result = await getStub(source).ensureStarted({
        sourceId: source.id,
        workspaceId: source.workspaceId,
        accountScope: source.externalIdentity,
        bootstrap,
      });
      return {
        started: Boolean(result?.running),
        status: result?.status ?? 'STARTING',
      };
    },

    async stop(source) {
      assertContainerSource(source);
      if (!isConfigured(source)) return { stopped: false, status: 'UNCONFIGURED' };
      const result = await getStub(source).stopRuntime();
      return {
        stopped: !result?.running,
        status: result?.status ?? 'DISABLED',
      };
    },

    async restart(source, { bootstrap = null } = {}) {
      assertContainerSource(source);
      if (!source.enabled) return { restarted: false, status: 'DISABLED' };
      if (!isConfigured(source)) return { restarted: false, status: 'UNCONFIGURED' };
      const result = await getStub(source).restartRuntime({
        sourceId: source.id,
        workspaceId: source.workspaceId,
        accountScope: source.externalIdentity,
        bootstrap,
      });
      return {
        restarted: Boolean(result?.running),
        status: result?.status ?? 'STARTING',
      };
    },

    async status(source) {
      assertContainerSource(source);
      if (!source.enabled) {
        return sanitizeStatus({ status: 'DISABLED', running: false, connected: false });
      }
      if (!isConfigured(source)) {
        return sanitizeStatus({ status: 'UNCONFIGURED', running: false, connected: false });
      }
      return sanitizeStatus(await getStub(source).runtimeStatus());
    },
  };
}
