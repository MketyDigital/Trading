import { resolveSymbolAgainstCatalog } from '../normalization/trading_normalizer.js';
import { buildMT5OrderCommand, buildMT5ManagementCommand } from '../execution/platform_translation.js';
import { buildMT5BridgeEnvelope, signMT5BridgeBody } from './mt5_bridge_protocol.js';

function resolveMT5Symbol(action, catalog) {
  if (!action.symbol) return null;
  const resolved = resolveSymbolAgainstCatalog(action.symbol, catalog);
  if (!resolved.ok) throw new Error(`MT5 symbol resolution failed: ${resolved.reason}`);
  return resolved;
}

async function reserve(deliveryStore, action) {
  if (!action.idempotencyKey) throw new TypeError('idempotencyKey required for MT5 execution');
  const result = await deliveryStore.reserve(action.idempotencyKey, { destinationType: 'mt5', action });
  if (result?.duplicate) return { duplicate: true, previous: result.result ?? null };
  if (!result?.ok) throw new Error('failed to reserve MT5 delivery idempotency');
  return { duplicate: false };
}

function classifiedError(message, { code, failureClass, cause } = {}) {
  const error = new Error(String(message || code || 'MT5 execution failed'), cause ? { cause } : undefined);
  if (code) error.code = code;
  if (failureClass) error.failureClass = failureClass;
  return error;
}

function bridgeError(message) {
  const text = String(message || 'MT5 bridge rejected request');
  if (text.includes('MT5_RECONCILIATION_AMBIGUOUS')) {
    return classifiedError(text, { code: 'MT5_RECONCILIATION_AMBIGUOUS', failureClass: 'UNCERTAIN' });
  }
  if (text.includes('MT5_RECONCILIATION_UNCERTAIN')) {
    return classifiedError(text, { code: 'MT5_RECONCILIATION_UNCERTAIN', failureClass: 'UNCERTAIN' });
  }
  return classifiedError(text, { code: 'MT5_BRIDGE_REJECTED', failureClass: 'TERMINAL' });
}

function transportError(error, action) {
  if (action.type === 'OPEN_POSITION') {
    return classifiedError(error?.message || 'MT5 transport failed', {
      code: 'MT5_TRANSPORT_AMBIGUOUS',
      failureClass: 'RETRYABLE',
      cause: error,
    });
  }
  return classifiedError(error?.message || 'MT5 management transport outcome uncertain', {
    code: 'MT5_MANAGEMENT_OUTCOME_UNCERTAIN',
    failureClass: 'UNCERTAIN',
    cause: error,
  });
}

async function persistFailure(deliveryStore, idempotencyKey, error, { nowMs, retryDelayMs }) {
  const failure = { code: error.code || 'MT5_EXECUTION_FAILED', error: error.message };
  if (error.failureClass === 'RETRYABLE') {
    if (!deliveryStore?.markRetryable) throw new Error('deliveryStore markRetryable required for retryable MT5 outcome');
    await deliveryStore.markRetryable(idempotencyKey, failure, {
      nextAttemptAt: new Date(Number(nowMs) + Number(retryDelayMs)).toISOString(),
    });
    return;
  }
  if (error.failureClass === 'UNCERTAIN') {
    if (!deliveryStore?.markUncertain) throw new Error('deliveryStore markUncertain required for uncertain MT5 outcome');
    await deliveryStore.markUncertain(idempotencyKey, failure);
    return;
  }
  await deliveryStore.fail(idempotencyKey, failure);
}

export async function executeMT5Action(action, {
  workspaceId,
  accountId,
  bridgeUrl,
  bridgeSecret,
  catalog = [],
  deliveryStore,
  fetchFn = fetch,
  nowMs = Date.now(),
  ttlMs = 15000,
  retryDelayMs = 15000,
} = {}) {
  if (!workspaceId || !accountId || !bridgeUrl || !bridgeSecret) throw new TypeError('workspace/account/bridge configuration required');
  if (!deliveryStore?.reserve || !deliveryStore?.complete || !deliveryStore?.fail) throw new TypeError('deliveryStore reserve/complete/fail required');

  const reserved = await reserve(deliveryStore, action);
  if (reserved.duplicate) return { duplicate: true, ...(reserved.previous || {}) };

  const symbol = resolveMT5Symbol(action, catalog);
  let command;
  if (action.type === 'OPEN_POSITION') {
    command = buildMT5OrderCommand(action, symbol);
    command.action = 'OPEN_POSITION';
  } else {
    command = buildMT5ManagementCommand(action, symbol || {});
  }

  const envelope = buildMT5BridgeEnvelope({
    commandId: action.idempotencyKey,
    workspaceId,
    accountId,
    issuedAt: nowMs,
    ttlMs,
    command,
  });
  const rawBody = JSON.stringify(envelope);
  const signature = await signMT5BridgeBody(rawBody, bridgeSecret);

  try {
    let response;
    try {
      response = await fetchFn(bridgeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Mkety-Signature': signature,
          'X-Mkety-Command-Id': action.idempotencyKey,
        },
        body: rawBody,
        signal: AbortSignal.timeout(8000),
      });
    } catch (error) {
      throw transportError(error, action);
    }

    let data = {};
    try {
      data = await response.json();
    } catch (error) {
      throw transportError(classifiedError(`MT5 bridge response unreadable: ${error?.message || 'invalid response'}`), action);
    }

    if (!response.ok || data?.ok === false) {
      throw bridgeError(data?.error || `MT5 bridge HTTP ${response.status}`);
    }

    const fillPrice = Number(data.fill_price ?? data.fillPrice ?? data.price);
    const result = {
      duplicate: false,
      brokerPositionId: data.position_id != null ? String(data.position_id) : data.ticket != null ? String(data.ticket) : null,
      brokerOrderId: data.order_id != null ? String(data.order_id) : null,
      brokerDealId: data.deal_id != null ? String(data.deal_id) : null,
      fillPrice: Number.isFinite(fillPrice) ? fillPrice : null,
      response: data,
    };
    await deliveryStore.complete(action.idempotencyKey, result);
    return result;
  } catch (error) {
    const classified = error?.failureClass ? error : transportError(error, action);
    await persistFailure(deliveryStore, action.idempotencyKey, classified, { nowMs, retryDelayMs });
    throw classified;
  }
}
