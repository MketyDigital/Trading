import { createSourceQueueConsumer } from './source_queue_consumer.js';
import { createSupabaseIngestStores } from '../storage/supabase_ingest_store.js';
import { handleV1EventsRequest } from '../http/v1_events.js';

async function defaultSupabaseFactory() {
  throw new Error('TRADING_STORAGE_RUNTIME_REQUIRED');
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

const TRANSIENT_COMPLETION_CORRELATION_REASONS = new Set([
  'NO_REPLY_TARGET',
  'NO_THREAD_TARGET',
  'AMBIGUOUS_FAST_ENTRY_COMPLETION',
]);

function shouldRetryOrchestration(result = {}) {
  if (result?.duplicate === true && result?.recoveryReady !== true) return true;
  if (result?.simulation?.status === 'BLOCKED') return true;

  const interpretation = result?.interpretation;
  const intent = interpretation?.intent;
  const hasProtection = intent?.stopLoss != null
    || (Array.isArray(intent?.takeProfits) && intent.takeProfits.length > 0);
  const isFullSignal = interpretation?.status === 'READY'
    && intent
    && (intent.incomplete === false || hasProtection);
  const reason = String(result?.simulation?.correlation?.reason || '').trim().toUpperCase();
  return Boolean(isFullSignal && TRANSIENT_COMPLETION_CORRELATION_REASONS.has(reason));
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
  return async function consumeSourceQueue(batch, env = {}, { persistenceRuntime = null } = {}) {
    if (!env?.TRADING_MASTER_KEY) {
      return retryAll(batch, new Error('TRADING_MASTER_KEY_NOT_CONFIGURED'));
    }

    let supabase;
    let stores;
    try {
      if (persistenceRuntime) stores = persistenceRuntime.ingest;
      else {
        supabase = await supabaseFactory(env);
        stores = storesFactory(supabase, { masterKey: env.TRADING_MASTER_KEY });
      }
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
          ...(persistenceRuntime ? { persistenceRuntime } : {
            supabaseFactory: async () => supabase,
            storesFactory: () => stores,
          }),
          orchestrateDuplicates: true,
        });

        let result = {};
        try {
          result = await response.json();
        } catch {
          result = {};
        }

        if (shouldRetryOrchestration(result)) {
          throw new Error('source event orchestration recovery is temporarily incomplete');
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
