import { buildMT5OrderCommand, buildMT5ManagementCommand } from '../execution/platform_translation.js';
import { resolveAccountSymbol } from '../execution/account_symbol_catalog.js';
import { buildMt5ConnectorEnvelope } from './mt5_connector_protocol.js';

function classifiedError(message, { code, failureClass, cause } = {}) {
  const error = new Error(String(message || code || 'MT5 connector execution failed'), cause ? { cause } : undefined);
  if (code) error.code = code;
  if (failureClass) error.failureClass = failureClass;
  return error;
}
function normalizeGatewayUrl(value) {
  const raw = String(value ?? '').trim().replace(/\/+$/, '');
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new TypeError('MT5 connector gateway URL must be clean https');
  return url.toString().replace(/\/$/, '');
}
async function identity({ baseUrl, accountRowId, controlSecret, fetchFn }) {
  let response;
  try {
    response = await fetchFn(`${baseUrl}/v1/mt5-connections/${encodeURIComponent(accountRowId)}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${controlSecret}` }, signal: AbortSignal.timeout(5000),
    });
  } catch (cause) {
    throw classifiedError('MT5 connector identity unavailable', { code: 'MT5_CONNECTOR_OFFLINE', failureClass: 'RETRYABLE', cause });
  }
  let body = {}; try { body = await response.json(); } catch {}
  if (!response.ok || body?.online !== true) throw classifiedError('MT5 connector offline', { code: 'MT5_CONNECTOR_OFFLINE', failureClass: 'RETRYABLE' });
  if (String(body.accountRowId ?? '') !== String(accountRowId)) throw classifiedError('MT5 connector account mismatch', { code: 'MT5_CONNECTOR_ACCOUNT_MISMATCH', failureClass: 'TERMINAL' });
  const accountNumber = String(body?.identity?.accountNumber ?? '').trim();
  if (!accountNumber) throw classifiedError('MT5 connector broker identity missing', { code: 'MT5_CONNECTOR_IDENTITY_INCOMPLETE', failureClass: 'RETRYABLE' });
  return { ...body.identity, accountNumber };
}
function commandFor(action, resolved) {
  if (action.type === 'OPEN_POSITION') {
    const command = buildMT5OrderCommand(action, resolved);
    command.action = 'OPEN_POSITION';
    return command;
  }
  return buildMT5ManagementCommand(action, resolved || {});
}
async function persistFailure(store, key, error, nowMs, retryDelayMs) {
  const failure = { code: error.code || 'MT5_CONNECTOR_EXECUTION_FAILED', error: error.message };
  if (error.failureClass === 'RETRYABLE' && store.markRetryable) return store.markRetryable(key, failure, { nextAttemptAt: new Date(nowMs + retryDelayMs).toISOString() });
  if (error.failureClass === 'UNCERTAIN' && store.markUncertain) return store.markUncertain(key, failure);
  return store.fail(key, failure);
}

export async function executeMt5ConnectorAction(action, {
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
  if (!workspaceId || !accountRowId || !gatewayUrl || !controlSecret) throw new TypeError('MT5 connector configuration required');
  if (!action?.idempotencyKey) throw new TypeError('idempotencyKey required');
  if (!deliveryStore?.reserve || !deliveryStore?.complete || !deliveryStore?.fail) throw new TypeError('delivery store required');
  const baseUrl = normalizeGatewayUrl(gatewayUrl);
  const connected = await identity({ baseUrl, accountRowId, controlSecret, fetchFn });
  const catalog = Array.isArray(connected.symbols) && connected.symbols.length ? connected.symbols : symbolCatalog;
  const resolved = action.symbol ? resolveAccountSymbol(action.symbol, catalog, symbolAliases) : null;
  if (action.symbol && !resolved?.ok) {
    throw classifiedError(`MT5 broker symbol resolution failed: ${resolved?.reason || 'SYMBOL_NOT_FOUND'}`, {
      code: resolved?.reason === 'AMBIGUOUS_SYMBOL' ? 'BROKER_SYMBOL_AMBIGUOUS' : 'BROKER_SYMBOL_NOT_FOUND', failureClass: 'TERMINAL',
    });
  }
  const reservation = await deliveryStore.reserve(action.idempotencyKey, { destinationType: 'mt5_connector', action });
  if (reservation?.duplicate) return { duplicate: true, ...(reservation.result || {}) };
  if (!reservation?.ok) throw new Error('failed to reserve MT5 connector delivery');

  const envelope = buildMt5ConnectorEnvelope({
    commandId: action.idempotencyKey, workspaceId, accountId: accountRowId, brokerAccountId: connected.accountNumber,
    issuedAt: nowMs, ttlMs, command: commandFor(action, resolved),
  });
  try {
    let response;
    try {
      response = await fetchFn(`${baseUrl}/v1/mt5-commands/${encodeURIComponent(accountRowId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${controlSecret}` },
        body: JSON.stringify(envelope), signal: AbortSignal.timeout(10000),
      });
    } catch (cause) {
      throw classifiedError('MT5 connector transport outcome uncertain', { code: 'MT5_CONNECTOR_TRANSPORT_UNCERTAIN', failureClass: 'UNCERTAIN', cause });
    }
    let body = {}; try { body = await response.json(); } catch { throw classifiedError('MT5 connector response unreadable', { code: 'MT5_CONNECTOR_RESULT_UNCERTAIN', failureClass: 'UNCERTAIN' }); }
    if (!response.ok || body?.ok === false) {
      const reason = String(body?.reason || body?.error || `HTTP_${response.status}`);
      if (reason === 'MT5_CONNECTOR_OFFLINE') throw classifiedError(reason, { code: reason, failureClass: 'RETRYABLE' });
      if (reason === 'MT5_RESULT_TIMEOUT') throw classifiedError(reason, { code: 'MT5_CONNECTOR_RESULT_UNCERTAIN', failureClass: 'UNCERTAIN' });
      throw classifiedError(reason, { code: 'MT5_CONNECTOR_REJECTED', failureClass: 'TERMINAL' });
    }
    const fillPrice = Number(body.fillPrice ?? body.fill_price);
    const result = {
      duplicate: false,
      brokerPositionId: body.positionId != null ? String(body.positionId) : body.position_id != null ? String(body.position_id) : null,
      brokerOrderId: body.orderId != null ? String(body.orderId) : body.order_id != null ? String(body.order_id) : null,
      brokerDealId: body.dealId != null ? String(body.dealId) : body.deal_id != null ? String(body.deal_id) : null,
      fillPrice: Number.isFinite(fillPrice) ? fillPrice : null,
      platformSymbol: resolved?.platformSymbol ?? null,
      response: body,
    };
    await deliveryStore.complete(action.idempotencyKey, result);
    return result;
  } catch (error) {
    const classified = error?.failureClass ? error : classifiedError(error?.message, { code: 'MT5_CONNECTOR_EXECUTION_FAILED', failureClass: 'TERMINAL', cause: error });
    await persistFailure(deliveryStore, action.idempotencyKey, classified, Number(nowMs), Number(retryDelayMs));
    throw classified;
  }
}
