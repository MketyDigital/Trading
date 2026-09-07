import { resolveMtprotoContainerBootstrap } from './container_bootstrap.js';

function trustedId(value, code) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(code);
  return normalized;
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

function runtimeName(identity) {
  return `mtproto:${identity.workspaceId}:${identity.accountScope}`;
}

export function createMtprotoContainerLifecycleService({
  namespace,
  supabase,
  masterKey,
  internalSourceUrl,
  internalSourceToken,
  bootstrapResolver = resolveMtprotoContainerBootstrap,
} = {}) {
  if (!namespace?.getByName) throw new TypeError('Cloudflare Container namespace binding is required');
  if (!supabase?.from) throw new TypeError('Supabase client is required');

  async function resolveTrusted(request = {}) {
    const workspaceId = trustedId(request.workspaceId, 'MTPROTO_WORKSPACE_REQUIRED');
    const sourceId = trustedId(request.sourceId, 'MTPROTO_SOURCE_REQUIRED');

    // Intentionally pass only trusted identifiers and server-side dependencies.
    // Any request.bootstrap or credential-like caller field is ignored.
    const resolved = await bootstrapResolver({
      supabase,
      workspaceId,
      sourceId,
      masterKey,
      internalSourceUrl,
      internalSourceToken,
    });

    const identity = resolved?.identity || {};
    if (
      String(identity.workspaceId ?? '') !== workspaceId
      || String(identity.sourceId ?? '') !== sourceId
      || !String(identity.accountScope ?? '').trim()
    ) {
      throw new Error('MTPROTO_RESOLVED_IDENTITY_MISMATCH');
    }
    if (!resolved?.bootstrap || typeof resolved.bootstrap !== 'object') {
      throw new Error('MTPROTO_BOOTSTRAP_NOT_AVAILABLE');
    }

    return resolved;
  }

  function stubFor(identity) {
    return namespace.getByName(runtimeName(identity));
  }

  return {
    async start(request = {}) {
      const { identity, bootstrap } = await resolveTrusted(request);
      const result = await stubFor(identity).ensureStarted({
        sourceId: identity.sourceId,
        workspaceId: identity.workspaceId,
        accountScope: identity.accountScope,
        bootstrap,
      });
      return {
        started: Boolean(result?.running),
        status: result?.status ?? 'STARTING',
      };
    },

    async restart(request = {}) {
      // Re-resolve every restart so rotations/revocations are authoritative and
      // stale caller/runtime bootstrap is never reused.
      const { identity, bootstrap } = await resolveTrusted(request);
      const result = await stubFor(identity).restartRuntime({
        sourceId: identity.sourceId,
        workspaceId: identity.workspaceId,
        accountScope: identity.accountScope,
        bootstrap,
      });
      return {
        restarted: Boolean(result?.running),
        status: result?.status ?? 'STARTING',
      };
    },

    async stop(request = {}) {
      const { identity } = await resolveTrusted(request);
      const result = await stubFor(identity).stopRuntime();
      return {
        stopped: !result?.running,
        status: result?.status ?? 'DISABLED',
      };
    },

    async status(request = {}) {
      const { identity } = await resolveTrusted(request);
      return sanitizeStatus(await stubFor(identity).runtimeStatus());
    },
  };
}
