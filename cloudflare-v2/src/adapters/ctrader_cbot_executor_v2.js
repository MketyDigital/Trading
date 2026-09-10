import { buildCTraderCbotEnvelope } from './ctrader_cbot_protocol.js';

function classifiedError(message, { code, failureClass, cause } = {}) {
  const error = new Error(String(message || code || 'cTrader cBot execution failed'), cause ? { cause } : undefined);
  if (code) error.code = code;
  if (failureClass) error.failureClass = failureClass;
  return error;
}

function normalizeGatewayUrl(value) {
  const raw = String(value ?? '').trim().replace(/\/+$/, '');
  if (!raw) throw new TypeError('cTrader cBot gatewayUrl required');
  let url;
  try { url = new URL(raw); } catch { throw new TypeError('cTrader cBot gatewayUrl invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new TypeError('cTrader cBot gatewayUrl must be clean https');
  }
  return url.toString().replace(/\/$/, '');
}

function commandFor(action = {}) {
  const command = { action: String(action.type || '').toUpperCase() };
  for (const [target, value] of [
    ['side', action.side], ['orderType', action.orderType], ['symbol', action.symbol], ['lots', action.lots],
    ['stopLoss', action.stopLoss], ['takeProfit', action.takeProfit], ['positionId', action.brokerPositionId],
    ['orderId', action.brokerOrderId],
  ]) {
    if (value != null && value !== '') command[target] = value;
  }
  const price = action?.entry?.kind === 'PRICE' ? action.entry.value : (action.entryPrice ?? action.price);
  if (price != null && price !== '') command.price = price;
  command.label = 'Mkety Trading';
  return command;
}

async function persistFailure(deliveryStore, key, error, nowMs, retryDelayMs) {
  const failure = { code: error.code || 'CTRADER_CBOT_EXECUTION_FAILED', error: error.message };
  if (error.failureClass === 'RETRYABLE' && deliveryStore?.markRetryable) {
    await deliveryStore.markRetryable(key, failure, { nextAttemptAt: new Date(Number(nowMs) + Number(retryDelayMs)).toISOString() });
    return;
  }
  if (error.failureClass === 'UNCERTAIN' && deliveryStore?.markUncertain) {
    await deliveryStore.markUncertain(key, failure);
    return;
  }
  await deliveryStore.fail(key, failure);
}

export async function executeCTraderCbotAction(action, {
  workspaceId,
  accountRowId,
  gatewayUrl,
  controlSecret,
  deliveryStore,
  fetchFn = fetch,
  nowMs = Date.now(),
  ttlMs = 15000,
  retryDelayMs = 15000,
} = {}) {
  if (!workspaceId || !accountRowId || !controlSecret) throw new TypeError('workspace/account/gateway control configuration required');
  if (!action?.idempotencyKey) throw new TypeError('idempotencyKey required for cTrader cBot execution');
  if (!deliveryStore?.reserve || !deliveryStore?.complete || !deliveryStore?.fail) throw new TypeError('deliveryStore reserve/complete/fail required');
  const baseUrl = normalizeGatewayUrl(gatewayUrl);

  const reservation = await deliveryStore.reserve(action.idempotencyKey, { destinationType: 'ctrader_cbot', action });
  if (reservation?.duplicate) return { duplicate: true, ...(reservation.result || {}) };
  if (!reservation?.ok) throw new Error('failed to reserve cTrader cBot delivery idempotency');

  const envelope = buildCTraderCbotEnvelope({
    commandId: action.idempotencyKey,
    workspaceId,
    accountId: accountRowId,
    issuedAt: nowMs,
    ttlMs,
    command: commandFor(action),
  });

  try {
    let response;
    try {
      response = await fetchFn(`${baseUrl}/v1/commands/${encodeURIComponent(accountRowId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${controlSecret}` },
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(10000),
      });
    } catch (cause) {
      throw classifiedError(cause?.message || 'cBot gateway transport outcome uncertain', {
        code: 'CTRADER_CBOT_TRANSPORT_UNCERTAIN', failureClass: 'UNCERTAIN', cause,
      });
    }

    let data = {};
    try { data = await response.json(); }
    catch (cause) {
      throw classifiedError('cBot gateway response unreadable', { code: 'CTRADER_CBOT_RESPONSE_UNCERTAIN', failureClass: 'UNCERTAIN', cause });
    }

    if (!response.ok || data?.ok === false) {
      const reason = String(data?.reason || `HTTP_${response.status}`);
      if (reason === 'CBOT_OFFLINE') {
        throw classifiedError('cTrader Cloud Auto Trader is offline', { code: 'CTRADER_CBOT_OFFLINE', failureClass: 'RETRYABLE' });
      }
      if (reason === 'CBOT_RESULT_TIMEOUT') {
        throw classifiedError('cTrader cBot execution result is uncertain', { code: 'CTRADER_CBOT_RESULT_UNCERTAIN', failureClass: 'UNCERTAIN' });
      }
      throw classifiedError(reason, { code: 'CTRADER_CBOT_REJECTED', failureClass: 'TERMINAL' });
    }

    const fillPrice = Number(data.fillPrice ?? data.fill_price);
    const result = {
      duplicate: false,
      brokerPositionId: data.positionId != null ? String(data.positionId) : null,
      brokerOrderId: data.orderId != null ? String(data.orderId) : null,
      brokerDealId: data.dealId != null ? String(data.dealId) : null,
      fillPrice: Number.isFinite(fillPrice) ? fillPrice : null,
      response: data,
    };
    await deliveryStore.complete(action.idempotencyKey, result);
    return result;
  } catch (error) {
    const classified = error?.failureClass ? error : classifiedError(error?.message, { code: 'CTRADER_CBOT_EXECUTION_FAILED', failureClass: 'TERMINAL', cause: error });
    await persistFailure(deliveryStore, action.idempotencyKey, classified, nowMs, retryDelayMs);
    throw classified;
  }
}
