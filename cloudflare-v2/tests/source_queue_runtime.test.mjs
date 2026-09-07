import test from 'node:test';
import assert from 'node:assert/strict';

import { createSourceQueueRuntime } from '../src/sources/source_queue_runtime.js';

function message() {
  return {
    body: {
      version: 'mkety.source-event.v1',
      sourceId: 'src-1',
      event: {
        source_external_id: 'telegram-account-1',
        external_event_id: 'telegram:-1001:88',
        occurred_at: '2026-09-02T07:00:00.000Z',
        text: 'BUY GOLD NOW',
        structured_payload: {},
        thread: {},
        metadata: {},
      },
    },
    acked: 0,
    retried: 0,
    ack() { this.acked += 1; },
    retry() { this.retried += 1; },
  };
}

test('runtime reuses one Supabase/stores context and dispatches signed request through V1 handler', async () => {
  const msg = message();
  const calls = { supabase: 0, stores: 0, events: 0 };
  const source = {
    id: 'src-1',
    source_type: 'telegram_mtproto',
    source_instance_id: 'telegram-account-1',
    external_identity: 'telegram-account-1',
    secret: 'server-only-secret',
  };
  const supabase = { marker: 'db' };
  const stores = {
    sourceStore: { async getActiveSource(id) { assert.equal(id, 'src-1'); return source; } },
    eventStore: {},
  };

  const runtime = createSourceQueueRuntime({
    async supabaseFactory(env) {
      calls.supabase += 1;
      assert.equal(env.TRADING_MASTER_KEY, 'master');
      return supabase;
    },
    storesFactory(client, options) {
      calls.stores += 1;
      assert.equal(client, supabase);
      assert.equal(options.masterKey, 'master');
      return stores;
    },
    async eventsHandler(request, env, options) {
      calls.events += 1;
      assert.equal(options.supabaseFactory instanceof Function, true);
      assert.equal(options.storesFactory instanceof Function, true);
      assert.equal(await options.supabaseFactory(env), supabase);
      assert.equal(options.storesFactory(supabase, { masterKey: 'master' }), stores);
      assert.equal(request.headers.get('X-Mkety-Source-Id'), 'src-1');
      assert.match(request.headers.get('X-Mkety-Signature'), /^v1=[a-f0-9]{64}$/);
      return new Response(JSON.stringify({ ok: true, duplicate: false, eventId: 'evt-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
    now: () => 1_788_333_600_000,
  });

  const result = await runtime({ messages: [msg] }, { TRADING_MASTER_KEY: 'master' });

  assert.deepEqual(result, { processed: 1, acknowledged: 1, retried: 0 });
  assert.equal(msg.acked, 1);
  assert.deepEqual(calls, { supabase: 1, stores: 1, events: 1 });
});

test('runtime retries every message when encryption/runtime configuration is missing', async () => {
  const a = message();
  const b = message();
  const runtime = createSourceQueueRuntime({
    async supabaseFactory() { throw new Error('must not open db'); },
  });

  const result = await runtime({ messages: [a, b] }, {});

  assert.deepEqual(result, { processed: 2, acknowledged: 0, retried: 2 });
  assert.equal(a.retried, 1);
  assert.equal(b.retried, 1);
});
