import { resolveSymbolAgainstCatalog } from '../normalization/trading_normalizer.js';
import { buildCTraderOrderCommand, buildCTraderManagementCommand } from '../execution/platform_translation.js';

function extractBrokerIds(message) {
  const payload = message?.payload || {};
  return {
    brokerPositionId: payload.position?.positionId ?? null,
    brokerOrderId: payload.order?.orderId ?? null,
    brokerDealId: payload.deal?.dealId ?? null,
  };
}

async function reserveAction(deliveryStore, action) {
  if (!action.idempotencyKey) throw new TypeError('idempotencyKey required for cTrader execution');
  const reservation = await deliveryStore.reserve(action.idempotencyKey, {
    destinationType: 'ctrader',
    action,
  });
  if (reservation?.duplicate) {
    return { duplicate: true, previous: reservation.result ?? null };
  }
  if (!reservation?.ok) throw new Error('failed to reserve cTrader delivery idempotency');
  return { duplicate: false, reservation };
}

function resolveCTraderSymbol(action, catalog) {
  const symbolName = action.symbol;
  if (!symbolName) return null;
  const resolved = resolveSymbolAgainstCatalog(symbolName, catalog);
  if (!resolved.ok) throw new Error(`cTrader symbol resolution failed: ${resolved.reason}`);
  return resolved;
}

export async function executeCTraderAction(action, {
  session,
  accountId,
  catalog = [],
  deliveryStore,
  label = 'Mkety Trading',
} = {}) {
  if (!session?.request) throw new TypeError('cTrader session required');
  if (!deliveryStore?.reserve || !deliveryStore?.complete || !deliveryStore?.fail) {
    throw new TypeError('deliveryStore reserve/complete/fail required');
  }

  const reserved = await reserveAction(deliveryStore, action);
  if (reserved.duplicate) {
    return { duplicate: true, ...(reserved.previous || {}) };
  }

  const clientMsgId = String(action.idempotencyKey);
  const symbol = resolveCTraderSymbol(action, catalog);

  try {
    let response;
    if (action.type === 'OPEN_POSITION') {
      const message = buildCTraderOrderCommand({ ...action, label }, {
        accountId,
        clientMsgId,
        symbol,
      });
      response = await session.request(message, { successPayloadTypes: [2126] });
      const ids = extractBrokerIds(response);

      // cTrader MARKET orders do not accept absolute SL/TP in ProtoOANewOrderReq.
      // Apply protection immediately after the position ID is known.
      if (action.orderType === 'MARKET' && ids.brokerPositionId && (action.stopLoss != null || action.takeProfit != null)) {
        const amend = buildCTraderManagementCommand({
          type: 'MODIFY_POSITION',
          brokerPositionId: ids.brokerPositionId,
          stopLoss: action.stopLoss,
          takeProfit: action.takeProfit,
        }, {
          accountId,
          clientMsgId: `${clientMsgId}:protect`,
          symbol,
        });
        await session.request(amend, { successPayloadTypes: [2126] });
      }

      const result = { duplicate: false, ...ids, response };
      await deliveryStore.complete(action.idempotencyKey, result);
      return result;
    }

    const managementMessage = buildCTraderManagementCommand(action, {
      accountId,
      clientMsgId,
      symbol: symbol || catalog.find((item) => item.platform === 'ctrader') || {},
    });
    response = await session.request(managementMessage, { successPayloadTypes: [2126] });
    const result = { duplicate: false, ...extractBrokerIds(response), response };
    await deliveryStore.complete(action.idempotencyKey, result);
    return result;
  } catch (error) {
    await deliveryStore.fail(action.idempotencyKey, {
      error: error.message,
    });
    throw error;
  }
}
