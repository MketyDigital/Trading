import { buildSignedSourceEventPayload } from './source_event_adapter.js';
import {
  PermanentSourceDeliveryError,
  RetryableSourceDeliveryError,
} from './signed_v1_client.js';

const SUPPORTED = new Set([
  'mt5_source_bridge',
  'ctrader_source',
  'custom_signed_api',
]);

function requiredProvider(value) {
  const providerType = String(value ?? '').trim();
  if (!SUPPORTED.has(providerType)) throw new Error('SOURCE_RUNTIME_PROVIDER_UNSUPPORTED');
  return providerType;
}

function normalizeRetryDelays(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('SOURCE_RUNTIME_RETRY_DELAYS_INVALID');
  return value.map((delay) => {
    const normalized = Number(delay);
    if (!Number.isFinite(normalized) || normalized < 0) {
      throw new Error('SOURCE_RUNTIME_RETRY_DELAYS_INVALID');
    }
    return normalized;
  });
}

function clockValue(nowMs) {
  const value = Number(nowMs());
  return Number.isFinite(value) ? value : null;
}

export function createNonTelegramSourceRuntime({
  providerType,
  client,
  retryDelaysMs = [],
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  nowMs = () => Date.now(),
} = {}) {
  const runtimeProvider = requiredProvider(providerType);
  if (!client || typeof client.send !== 'function') throw new Error('SOURCE_RUNTIME_CLIENT_REQUIRED');
  if (typeof sleep !== 'function') throw new Error('SOURCE_RUNTIME_SLEEP_REQUIRED');
  if (typeof nowMs !== 'function') throw new Error('SOURCE_RUNTIME_CLOCK_REQUIRED');
  const retryDelays = normalizeRetryDelays(retryDelaysMs);

  const state = {
    status: 'idle',
    lastEventId: null,
    deliveryAttempts: 0,
    deliverySuccesses: 0,
    retryableFailures: 0,
    permanentFailures: 0,
    lastSuccessAtMs: null,
    lastFailureAtMs: null,
  };

  function snapshot() {
    return { ...state };
  }

  async function deliver(input = {}) {
    if (String(input?.providerType ?? '').trim() !== runtimeProvider) {
      throw new Error('SOURCE_RUNTIME_PROVIDER_MISMATCH');
    }

    const payload = buildSignedSourceEventPayload(input);
    state.lastEventId = payload.external_event_id;

    for (let attempt = 0; ; attempt += 1) {
      state.deliveryAttempts += 1;
      try {
        const result = await client.send(payload);
        state.deliverySuccesses += 1;
        state.status = 'healthy';
        state.lastSuccessAtMs = clockValue(nowMs);
        return result;
      } catch (error) {
        state.status = 'degraded';
        state.lastFailureAtMs = clockValue(nowMs);

        if (error instanceof RetryableSourceDeliveryError) {
          state.retryableFailures += 1;
          if (attempt >= retryDelays.length) throw error;
          await sleep(retryDelays[attempt]);
          continue;
        }

        state.permanentFailures += 1;
        if (error instanceof PermanentSourceDeliveryError) throw error;
        throw error;
      }
    }
  }

  return Object.freeze({
    deliver,
    status: snapshot,
  });
}
