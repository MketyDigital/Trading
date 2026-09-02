import { TelegramClient } from '@mtcute/web';
import { createSourceEventQueue } from '../sources/source_event_queue.js';
import { createMtprotoDoProvider } from '../sources/mtproto/do_provider.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Alternate first-party Telegram MTProto provider backed by one isolated
 * Cloudflare Durable Object instance per configured source/runtime identity.
 *
 * This provider is intentionally not a platform-wide startup dependency and
 * never forwards directly to the legacy global router. Native events enter the
 * same SOURCE_EVENT_QUEUE -> signed V1 ingestion path as other first-party
 * source runtimes.
 */
export class MTProtoListenerNode {
  constructor(state, env, deps = {}) {
    this.state = state;
    this.env = env || {};

    if (deps.provider) {
      this.provider = deps.provider;
    } else {
      const sourceQueue = createSourceEventQueue({ queue: this.env.SOURCE_EVENT_QUEUE });
      const clientFactory = deps.clientFactory || ((options) => new TelegramClient(options));
      this.provider = createMtprotoDoProvider({
        state: this.state,
        clientFactory,
        enqueueSourceEvent: (source, event) => sourceQueue.enqueueSourceEvent(source, event),
      });
    }

    // A DO resurrection must never create a platform-wide failure. If this
    // source was active, its own alarm/reconnect path may restore it; failures
    // remain local to this DO/source and are reflected by provider health.
    if (typeof this.state?.blockConcurrencyWhile === 'function') {
      this.state.blockConcurrencyWhile(async () => {
        const active = Boolean(await this.state.storage.get('is_active'));
        if (!active) return;
        try {
          await this.provider.alarm();
        } catch {
          // Intentionally isolated: Cloudflare alarm retries and later control
          // probes can recover this source without blocking sibling providers.
        }
      });
    }
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;

    try {
      if (path === '/start') {
        if (request.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);
        const body = await request.json();
        if (body.phone !== undefined && body.phone !== null) {
          await this.state.storage.put('phone', String(body.phone));
        }

        const health = await this.provider.start({
          sourceId: body.sourceId,
          workspaceId: body.workspaceId,
          accountScope: body.accountScope,
          apiId: body.apiId,
          apiHash: body.apiHash,
        });
        return jsonResponse(health);
      }

      if (path === '/send_code') {
        if (request.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);
        const body = await request.json();
        const phone = await this.state.storage.get('phone');
        await this.provider.authenticate({ phone, code: body.code });
        // Session material is persisted inside this exact provider/DO only and
        // is never returned through a normal control response.
        return jsonResponse({ status: 'authenticated' });
      }

      if (path === '/stop') {
        if (request.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);
        return jsonResponse(await this.provider.stop());
      }

      if (path === '/status') {
        if (request.method !== 'GET') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);
        return jsonResponse(await this.provider.status());
      }
    } catch {
      // Never echo provider/Telegram errors because upstream exceptions can
      // contain credential/session material.
      return jsonResponse({ error: 'MTPROTO_DO_CONTROL_FAILED' }, 500);
    }

    return jsonResponse({ error: 'NOT_FOUND' }, 404);
  }

  async alarm() {
    return this.provider.alarm();
  }
}
