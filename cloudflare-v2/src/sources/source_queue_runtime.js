import { createSourceQueueConsumer } from './source_queue_consumer.js';
import { createSupabaseIngestStores } from '../storage/supabase_ingest_store.js';
import { handleV1EventsRequest } from '../http/v1_events.js';

async function defaultSupabaseFactory(env) {
  const url = env?.SUPABASE_URL;
  const key = env?.SUPABASE_SERVICE_ROLE || env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials are not configured');
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key);
}

function messagesOf(batch) {
  return Array.isArray(batch?.messages) ? batch.messages : [];
}

function retryAll(batch, error) {
  const messages = messagesOf(batch);
  if (error) console.warn('Source queue runtime unavailable:', error?.message || error);
  for (const message of messages) {
    if (typeof message?.retry === 'function') message.retry();
  }
  return {
    processed: messages.length,
    acknowledged: 0,
    retried: messages.length,
  };
}

function signedRequest({ rawBody, sourceId, timestamp, signature }) {
  return new Request('https://trading.internal/api/v1/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Mkety-Source-Id': sourceId,
      'X-Mkety-Timestamp': timestamp,
      'X-Mkety-Signature': signature,
    },
    body: rawBody,
  });
}

export function createSourceQueueRuntime({
  supabaseFactory = defaultSupabaseFactory,
  storesFactory = createSupabaseIngestStores,
  eventsHandler = handleV1EventsRequest,
  now = Date.now,
} = {}) {
  return async function consumeSourceQueue(batch, env = {}) {
    if (!env?.TRADING_MASTER_KEY) {
      return retryAll(batch, new Error('TRADING_MASTER_KEY_NOT_CONFIGURED'));
    }

    let supabase;
    let stores;
    try {
      supabase = await supabaseFactory(env);
      stores = storesFactory(supabase, { masterKey: env.TRADING_MASTER_KEY });
      if (!stores?.sourceStore?.getActiveSource) {
        throw new Error('source store is unavailable');
      }
    } catch (error) {
      return retryAll(batch, error);
    }

    const consumer = createSourceQueueConsumer({
      sourceResolver: (sourceId) => stores.sourceStore.getActiveSource(sourceId),
      now,
      dispatch: async (signed) => {
        const response = await eventsHandler(signedRequest(signed), env, {
          supabaseFactory: async () => supabase,
          storesFactory: () => stores,
        });

        let result = {};
        try {
          result = await response.json();
        } catch {
          result = {};
        }

        return {
          ...result,
          status: response.status,
        };
      },
    });

    return consumer(batch);
  };
}
