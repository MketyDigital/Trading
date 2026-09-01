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
    const response = await fetchFn(bridgeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Mkety-Signature': signature,
        'X-Mkety-Command-Id': action.idempotencyKey,
      },
      body: rawBody,
      signal: AbortSignal.timeout(8000),
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || `MT5 bridge HTTP ${response.status}`);
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
    await deliveryStore.fail(action.idempotencyKey, { error: error.message });
    throw error;
  }
}
