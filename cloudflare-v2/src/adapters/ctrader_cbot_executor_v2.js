import { buildCTraderCbotEnvelope } from './ctrader_cbot_protocol.js';
import { resolveAccountSymbol } from '../execution/account_symbol_catalog.js';

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

function commandFor(action = {}, resolvedSymbol = null) {
  const command = { action: String(action.type || '').toUpperCase() };
  for (const [target, value] of [
    ['side', action.side], ['orderType', action.orderType], ['symbol', resolvedSymbol?.platformSymbol ?? action.symbol], ['lots', action.lots],
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

async function loadAuthenticatedIdentity({ baseUrl, accountRowId, controlSecret, fetchFn }) {
  let response;
  try {
    response = await fetchFn(`${baseUrl}/v1/connections/${encodeURIComponent(accountRowId)}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${controlSecret}` },
      signal: AbortSignal.timeout(5000),
    });
  } catch (cause) {
    throw classifiedError('cTrader Cloud Auto Trader identity is unavailable', {
      code: 'CTRADER_CBOT_IDENTITY_UNAVAILABLE', failureClass: 'RETRYABLE', cause,
    });
  }
  let data = {};
  try { data = await response.json(); }
  catch (cause) {
    throw classifiedError('cTrader Cloud Auto Trader identity response unreadable', {
      code: 'CTRADER_CBOT_IDENTITY_UNAVAILABLE', failureClass: 'RETRYABLE', cause,
    });
  }
  const reason = String(data?.reason || '');
  if (!response.ok || data?.ok === false || data?.online !== true) {
    if (reason === 'CBOT_OFFLINE' || response.status === 404) {
      throw classifiedError('cTrader Cloud Auto Trader is offline', { code: 'CTRADER_CBOT_OFFLINE', failureClass: 'RETRYABLE' });
    }
    throw classifiedError('cTrader Cloud Auto Trader identity is unavailable', { code: 'CTRADER_CBOT_IDENTITY_UNAVAILABLE', failureClass: 'RETRYABLE' });
  }
  if (String(data?.accountRowId ?? '') !== String(accountRowId)) {
    throw classifiedError('cTrader cBot gateway returned the wrong Mkety account', { code: 'CTRADER_CBOT_ACCOUNT_MISMATCH', failureClass: 'TERMINAL' });
  }
  const brokerAccountId = String(data?.identity?.accountNumber ?? '').trim();
  if (!brokerAccountId) {
    throw classifiedError('cTrader Cloud Auto Trader broker identity is missing', { code: 'CTRADER_CBOT_IDENTITY_UNAVAILABLE', failureClass: 'RETRYABLE' });
  }
  return {
    brokerAccountId,
    symbols: Array.isArray(data?.identity?.symbols) ? data.identity.symbols : [],
    brokerName: String(data?.identity?.brokerName ?? '').trim() || null,
  };
}

function resolveExecutionSymbol(action, identity, fallbackCatalog = [], symbolAliases = {}) {
  if (!action?.symbol) return null;
  const liveCatalog = Array.isArray(identity?.symbols) && identity.symbols.length ? identity.symbols : fallbackCatalog;
  const resolved = resolveAccountSymbol(action.symbol, liveCatalog, symbolAliases);
  if (!resolved.ok) {
    throw classifiedError(`cTrader broker symbol resolution failed: ${resolved.reason}`, {
      code: resolved.reason === 'AMBIGUOUS_SYMBOL' ? 'BROKER_SYMBOL_AMBIGUOUS' : 'BROKER_SYMBOL_NOT_FOUND',
      failureClass: 'TERMINAL',
    });
  }
  return resolved;
}

export async function executeCTraderCbotAction(action, {
  workspaceId,
  accountRowId,
  gatewayUrl,
  controlSecret,
  symbolCatalog = [],
  symbolAliases = {},
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
  const identity = await loadAuthenticatedIdentity({ baseUrl, accountRowId, controlSecret, fetchFn });
  const resolvedSymbol = resolveExecutionSymbol(action, identity, symbolCatalog, symbolAliases);

  const reservation = await deliveryStore.reserve(action.idempotencyKey, { destinationType: 'ctrader_cbot', action });
  if (reservation?.duplicate) return { duplicate: true, ...(reservation.result || {}) };
  if (!reservation?.ok) throw new Error('failed to reserve cTrader cBot delivery idempotency');

  const envelope = buildCTraderCbotEnvelope({
    commandId: action.idempotencyKey,
    workspaceId,
    accountId: accountRowId,
    brokerAccountId: identity.brokerAccountId,
    issuedAt: nowMs,
    ttlMs,
    command: commandFor(action, resolvedSymbol),
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
      if (reason === 'CBOT_BROKER_ACCOUNT_MISMATCH') {
        throw classifiedError('cTrader cBot broker account identity mismatch', { code: 'CTRADER_CBOT_BROKER_ACCOUNT_MISMATCH', failureClass: 'TERMINAL' });
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
      platformSymbol: resolvedSymbol?.platformSymbol ?? null,
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
